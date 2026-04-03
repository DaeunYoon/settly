// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IFXOracle} from "./interfaces/IFXOracle.sol";

contract FXOracle is IFXOracle {
    /// @notice How many EURC per 1 USDC, scaled by 1e6 (e.g. 920000 = 0.92 EURC per USDC)
    uint256 public usdcToEurcRate;
    uint256 public rateLastUpdated;
    address public owner;

    event RateUpdated(uint256 newRate, uint256 timestamp);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized");
        _;
    }

    constructor(uint256 _initialRate) {
        require(_initialRate > 0, "Invalid rate");
        owner = msg.sender;
        usdcToEurcRate = _initialRate;
        rateLastUpdated = block.timestamp;
        emit RateUpdated(_initialRate, block.timestamp);
    }

    function updateRate(uint256 _newRate) external onlyOwner {
        require(_newRate > 0, "Invalid rate");
        usdcToEurcRate = _newRate;
        rateLastUpdated = block.timestamp;
        emit RateUpdated(_newRate, block.timestamp);
    }

    function getRate() external view override returns (uint256 rate, uint256 updatedAt) {
        return (usdcToEurcRate, rateLastUpdated);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
