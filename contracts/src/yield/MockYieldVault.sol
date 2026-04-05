// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockYieldVault — ERC-4626-style vault that simulates yield via admin-controlled exchange rate
/// @dev Deploy one per yield token (msUSDS, msUSDe). Admin calls advanceYield() to simulate time-accelerated yield.
contract MockYieldVault is ERC20 {
    using SafeERC20 for IERC20;

    IERC20 public immutable asset;
    address public admin;

    /// @dev Target APY in basis points (e.g., 375 = 3.75%)
    uint256 public immutable targetAPYBps;

    /// @dev Exchange rate scaled by 1e18. 1e18 = 1:1 asset per share.
    uint256 public exchangeRate = 1e18;

    event Deposited(address indexed user, uint256 assets, uint256 shares);
    event Withdrawn(address indexed user, uint256 shares, uint256 assets);
    event YieldAdvanced(uint256 elapsedSeconds, uint256 newRate);

    constructor(
        address _asset,
        string memory _name,
        string memory _symbol,
        uint256 _targetAPYBps
    ) ERC20(_name, _symbol) {
        require(_asset != address(0), "Zero asset");
        asset = IERC20(_asset);
        admin = msg.sender;
        targetAPYBps = _targetAPYBps;
    }

    // ─── Admin ──────────────────────────────────────────────────

    /// @notice Simulate yield accrual by advancing the exchange rate
    /// @param elapsedSeconds Simulated time to accrue (e.g., 30 days = 2592000)
    function advanceYield(uint256 elapsedSeconds) external {
        require(msg.sender == admin, "Not admin");

        // Linear approximation: rate *= (1 + APY * elapsed / YEAR)
        // Good enough for demo — no compounding needed
        uint256 yearSeconds = 365.25 days;
        uint256 increase = (exchangeRate * targetAPYBps * elapsedSeconds) / (10_000 * yearSeconds);
        exchangeRate += increase;

        emit YieldAdvanced(elapsedSeconds, exchangeRate);
    }

    /// @notice Manually set exchange rate (for demo convenience)
    function setExchangeRate(uint256 newRate) external {
        require(msg.sender == admin, "Not admin");
        require(newRate >= 1e18, "Rate below 1:1");
        exchangeRate = newRate;
    }

    // ─── ERC-4626 Core ─────────────────────────────────────────

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        require(assets > 0, "Zero amount");
        shares = convertToShares(assets);
        require(shares > 0, "Zero shares");

        asset.safeTransferFrom(msg.sender, address(this), assets);
        _mint(receiver, shares);

        emit Deposited(receiver, assets, shares);
    }

    function redeem(uint256 shares, address receiver) external returns (uint256 assets) {
        require(shares > 0, "Zero amount");
        require(balanceOf(msg.sender) >= shares, "Insufficient shares");

        assets = convertToAssets(shares);
        require(assets > 0, "Zero assets");

        _burn(msg.sender, shares);
        asset.safeTransfer(receiver, assets);

        emit Withdrawn(receiver, shares, assets);
    }

    // ─── View ───────────────────────────────────────────────────

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return (shares * exchangeRate) / 1e18;
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return (assets * 1e18) / exchangeRate;
    }

    function totalAssets() external view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    function decimals() public pure override returns (uint8) {
        return 6; // Match USDC decimals
    }
}
