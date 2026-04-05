// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IMockYieldVault {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function redeem(uint256 shares, address receiver) external returns (uint256 assets);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function advanceYield(uint256 elapsedSeconds) external;
}

/// @title YieldStrategy — routes deposits across vaults per strategy allocation
/// @dev Manages 3 strategies using msUSDS vault, msUSDe vault, and WETH.
///      Deposits are split by weight. Withdrawals redeem all positions.
///
///      Strategies:
///        Conservative: 100% msUSDS
///        Balanced:     50% msUSDS + 50% msUSDe
///        Aggressive:   50% msUSDS + 50% WETH (held as-is, no vault)
contract YieldStrategy is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Strategy { Conservative, Balanced, Aggressive }

    IERC20 public immutable usdc;
    IMockYieldVault public immutable msUSDS;
    IMockYieldVault public immutable msUSDe;
    IERC20 public immutable weth;
    address public admin;

    struct Position {
        uint256 msUSDS_shares;
        uint256 msUSDe_shares;
        uint256 weth_amount;
        uint256 usdcDeposited;
        Strategy strategy;
        bool active;
    }

    // groupId => Position
    mapping(uint256 => Position) public positions;

    event Deposited(uint256 indexed groupId, Strategy strategy, uint256 usdcAmount);
    event Withdrawn(uint256 indexed groupId, uint256 totalReturned);
    event AllYieldsAdvanced(uint256 elapsedSeconds);

    constructor(
        address _usdc,
        address _msUSDS,
        address _msUSDe,
        address _weth
    ) {
        require(_usdc != address(0) && _msUSDS != address(0) && _msUSDe != address(0) && _weth != address(0), "Zero address");
        usdc = IERC20(_usdc);
        msUSDS = IMockYieldVault(_msUSDS);
        msUSDe = IMockYieldVault(_msUSDe);
        weth = IERC20(_weth);
        admin = msg.sender;
    }

    // ─── Deposit ────────────────────────────────────────────────

    /// @notice Deposit USDC into a yield strategy on behalf of a group
    /// @dev Can be called multiple times — top-ups accumulate into the existing position.
    /// @param amount USDC amount (6 decimals)
    /// @param strategy Which strategy to use (ignored on top-ups, uses existing)
    /// @param groupId The group to track the position for
    function deposit(
        uint256 amount,
        Strategy strategy,
        uint256 groupId
    ) external nonReentrant {
        require(amount > 0, "Zero amount");

        // Pull USDC from caller
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        Position storage pos = positions[groupId];

        // Top-up: use existing strategy, just accumulate shares
        if (pos.active) {
            strategy = pos.strategy;
        } else {
            pos.strategy = strategy;
            pos.active = true;
        }
        pos.usdcDeposited += amount;

        if (strategy == Strategy.Conservative) {
            // 100% msUSDS
            usdc.approve(address(msUSDS), amount);
            pos.msUSDS_shares += msUSDS.deposit(amount, address(this));
        } else if (strategy == Strategy.Balanced) {
            // 50% msUSDS + 50% msUSDe
            uint256 half = amount / 2;
            uint256 remainder = amount - half;

            usdc.approve(address(msUSDS), half);
            pos.msUSDS_shares += msUSDS.deposit(half, address(this));

            usdc.approve(address(msUSDe), remainder);
            pos.msUSDe_shares += msUSDe.deposit(remainder, address(this));
        } else {
            // Aggressive: 50% msUSDS + 50% WETH
            // USDC half goes to msUSDS; WETH tracked via depositWETH().
            usdc.approve(address(msUSDS), amount);
            pos.msUSDS_shares += msUSDS.deposit(amount, address(this));
        }

        emit Deposited(groupId, strategy, amount);
    }

    /// @notice Deposit WETH portion for aggressive strategy (called separately after Uniswap swap)
    function depositWETH(uint256 amount, uint256 groupId) external nonReentrant {
        require(amount > 0, "Zero amount");
        require(positions[groupId].active, "No active position");
        require(positions[groupId].strategy == Strategy.Aggressive, "Not aggressive");

        weth.safeTransferFrom(msg.sender, address(this), amount);
        positions[groupId].weth_amount += amount;
    }

    // ─── Withdraw ───────────────────────────────────────────────

    /// @notice Withdraw all positions, returning USDC (+ WETH for aggressive)
    /// @param groupId The group to withdraw for
    /// @return usdcReturned Total USDC redeemed from vaults
    function withdraw(uint256 groupId) external nonReentrant returns (uint256 usdcReturned) {
        Position storage pos = positions[groupId];
        require(pos.active, "No active position");

        if (pos.msUSDS_shares > 0) {
            usdcReturned += msUSDS.redeem(pos.msUSDS_shares, msg.sender);
        }
        if (pos.msUSDe_shares > 0) {
            usdcReturned += msUSDe.redeem(pos.msUSDe_shares, msg.sender);
        }
        if (pos.weth_amount > 0) {
            // Return WETH directly (caller can swap back to USDC via Uniswap)
            weth.safeTransfer(msg.sender, pos.weth_amount);
        }

        emit Withdrawn(groupId, usdcReturned);

        // Clear position
        delete positions[groupId];
    }

    // ─── View ───────────────────────────────────────────────────

    /// @notice Get current value of a position in USDC terms (excludes WETH value)
    function getPositionValue(uint256 groupId) external view returns (
        uint256 deposited,
        uint256 currentValue,
        uint256 wethHeld
    ) {
        Position storage pos = positions[groupId];
        if (!pos.active) return (0, 0, 0);

        deposited = pos.usdcDeposited;
        if (pos.msUSDS_shares > 0) {
            currentValue += msUSDS.convertToAssets(pos.msUSDS_shares);
        }
        if (pos.msUSDe_shares > 0) {
            currentValue += msUSDe.convertToAssets(pos.msUSDe_shares);
        }
        wethHeld = pos.weth_amount;
    }

    /// @notice Get detailed breakdown of a position
    function getStrategyBreakdown(uint256 groupId) external view returns (
        Strategy strategy,
        uint256 msUSDS_value,
        uint256 msUSDe_value,
        uint256 weth_value,
        uint256 totalUsdcValue
    ) {
        Position storage pos = positions[groupId];
        if (!pos.active) return (Strategy.Conservative, 0, 0, 0, 0);

        strategy = pos.strategy;
        if (pos.msUSDS_shares > 0) {
            msUSDS_value = msUSDS.convertToAssets(pos.msUSDS_shares);
        }
        if (pos.msUSDe_shares > 0) {
            msUSDe_value = msUSDe.convertToAssets(pos.msUSDe_shares);
        }
        weth_value = pos.weth_amount; // In WETH units, not USD
        totalUsdcValue = msUSDS_value + msUSDe_value;
    }

    function isPositionActive(uint256 groupId) external view returns (bool) {
        return positions[groupId].active;
    }

    // ─── Admin ──────────────────────────────────────────────────

    /// @notice Advance yield on all vaults (demo convenience)
    function advanceAllYields(uint256 elapsedSeconds) external {
        require(msg.sender == admin, "Not admin");
        msUSDS.advanceYield(elapsedSeconds);
        msUSDe.advanceYield(elapsedSeconds);
        emit AllYieldsAdvanced(elapsedSeconds);
    }
}
