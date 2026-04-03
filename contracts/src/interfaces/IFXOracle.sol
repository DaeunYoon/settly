// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFXOracle {
    function getRate() external view returns (uint256 rate, uint256 updatedAt);
}
