// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.7.5;

contract BondOwnable {
    address public policy;
    address public bondManager;

    constructor() {
        policy = msg.sender;
        bondManager = msg.sender;
    }

    modifier onlyPolicy() {
        require(msg.sender == policy, "BondOwnable: caller is not the owner");
        _;
    }

    modifier onlyBondManager() {
        require(msg.sender == bondManager, "BondOwnable: caller is not the bond manager");
        _;
    }
    function transferBondManagement(address _newManager) external onlyPolicy {
        require(_newManager != address(0), "BondOwnable: _newManager must not be zero address");
        bondManager = _newManager;
    }

    function transferOwnership(address _newOwner) external onlyPolicy {
        require(_newOwner != address(0), "BondOwnable: newOwner must not be zero address");
        policy = _newOwner;
    }
}
