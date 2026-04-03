// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IGroupPot {
    function isMember(uint256 groupId, address user) external view returns (bool);
    function getBaseCurrency(uint256 groupId) external view returns (address);
    function getMembers(uint256 groupId) external view returns (address[] memory);
}
