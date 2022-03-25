// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import "../types/BondOwnable.sol";
import "../libraries/SafeMath.sol";
import "../libraries/SafeERC20.sol";
import "../libraries/FixedPoint.sol";
import "../interfaces/ITreasury.sol";
import "../interfaces/IERC20.sol";
import "../interfaces/IHelper.sol";
import "./Fees.sol";

contract CustomBond is BondOwnable {
    using FixedPoint for *;
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    event BondCreated(uint256 deposit, uint256 payout, uint256 expires);

    event BondRedeemed(address recipient, uint256 payout, uint256 remaining);

    event BondPriceChanged(uint256 internalPrice, uint256 debtRatio);

    event ControlVariableAdjustment(uint256 initialBCV, uint256 newBCV, uint256 adjustment, bool addition);

    event LPAdded(address lpAddress, uint256 lpAmount);

    IERC20 public immutable PAYOUT_TOKEN; // token paid for principal
    ITreasury public immutable CUSTOM_TREASURY; // pays for and receives principal
    address public immutable SUBSIDY_ROUTER; // pays subsidy in TAO to custom treasury
    address public immutable HELPER; // helper for helping swap, lend to get lp token
    address public immutable FEES; // Fees contract
    address public OLY_TREASURY; // receives fee
    address public principalToken; // inflow token
    uint256 public totalPrincipalBonded;
    uint256 public totalPayoutGiven;
    uint256 public totalDebt; // total value of outstanding bonds; used for pricing
    uint256 public lastDecay; // reference block for debt decay
    uint256 public payoutSinceLastSubsidy; // principal accrued since subsidy paid
    uint256 public maxFeeAllowed = 50000; //maximum amount of fee allowed to charged - 5%
    Terms public terms; // stores terms for new bonds
    Adjust public adjustment; // stores adjustment to BCV data
    bool public lpTokenAsFeeFlag;//
    bool public bondWithOneAssetFlag;

    mapping(address => Bond) public bondInfo; // stores bond information for depositors

    // Info for creating new bonds
    struct Terms {
        uint256 controlVariable; // scaling variable for price
        uint256 vestingTerm; // in blocks
        uint256 minimumPrice; // vs principal value
        uint256 maxPayout; // in thousandths of a %. i.e. 500 = 0.5%
        uint256 maxDebt; // payout token decimal debt ratio, max % total supply created as debt
    }

    // Info for bond holder
    struct Bond {
        uint256 payout; // payout token remaining to be paid
        uint256 vesting; // Blocks left to vest
        uint256 lastBlock; // Last interaction
        uint256 truePricePaid; // Price paid (principal tokens per payout token) in ten-millionths - 4000000 = 0.4
    }

    // Info for incremental adjustments to control variable
    struct Adjust {
        bool add; // addition or subtraction
        uint256 rate; // increment
        uint256 target; // BCV when adjustment finished
        uint256 buffer; // minimum length (in blocks) between adjustments
        uint256 lastBlock; // block when last adjustment made
    }

    receive() external payable {}

    constructor(
        address _customTreasury,
        address _payoutToken,
        address _principalToken,
        address _olyTreasury,
        address _subsidyRouter,
        address _initialOwner,
        address _helper,
        address _fees
    ) {
        require(_customTreasury != address(0), "Factory: customTreasury bad");
        CUSTOM_TREASURY = ITreasury(_customTreasury);
        require(_payoutToken != address(0), "Factory: payoutToken bad");
        PAYOUT_TOKEN = IERC20(_payoutToken);
        require(_principalToken != address(0), "Factory: principalToken bad");
        principalToken = _principalToken;
        require(_olyTreasury != address(0), "Factory: olyTreasury bad");
        OLY_TREASURY = _olyTreasury;
        require(_subsidyRouter != address(0), "Factory: subsidyRouter bad");
        SUBSIDY_ROUTER = _subsidyRouter;
        require(_initialOwner != address(0), "Factory: initialOwner bad");
        policy = _initialOwner;
        bondManager = _initialOwner;
        require(_helper != address(0), "Factory: helper bad");
        HELPER = _helper;
        require(_fees != address(0), "Factory: FEES bad");
        FEES = _fees;

        lpTokenAsFeeFlag = true;
    }

    /* ======== INITIALIZATION ======== */

    /**
     *  @notice initializes bond parameters
     *  @param _controlVariable uint
     *  @param _vestingTerm uint
     *  @param _minimumPrice uint
     *  @param _maxPayout uint
     *  @param _maxDebt uint
     *  @param _initialDebt uint
     */
    function initializeBond(
        uint256 _controlVariable,
        uint256 _vestingTerm,
        uint256 _minimumPrice,
        uint256 _maxPayout,
        uint256 _maxDebt,
        uint256 _initialDebt
    ) external onlyPolicy {

        require(terms.controlVariable == 0 && _controlVariable > 0, "initializeBond: controlVariable must be 0");

        require(_vestingTerm >= 10000, "Vesting must be longer than 36 hours");

        require(_maxPayout <= 1000, "Payout cannot be above 1 percent");

        terms = Terms({
            controlVariable: _controlVariable,
            vestingTerm: _vestingTerm,
            minimumPrice: _minimumPrice,
            maxPayout: _maxPayout,
            maxDebt: _maxDebt
        });

        totalDebt = _initialDebt;
        lastDecay = block.number;
        CUSTOM_TREASURY.toggleBondContract(address(this));
    }

    /// @notice set fee flag
    /// @param _lpTokenAsFeeFlag bool
    function setLPtokenAsFee(bool _lpTokenAsFeeFlag) external onlyPolicy {
        lpTokenAsFeeFlag = _lpTokenAsFeeFlag;
    }

    /* ======== POLICY FUNCTIONS ======== */

    enum PARAMETER {
        VESTING,
        PAYOUT,
        DEBT
    }

    /**
     *  @notice set parameters for new bonds
     *  @param _parameter PARAMETER
     *  @param _input uint
     */
    function setBondTerms(PARAMETER _parameter, uint256 _input) external onlyBondManager {
        if (_parameter == PARAMETER.VESTING) {// 0
            require(_input >= 10000, "Vesting must be longer than 36 hours");
            terms.vestingTerm = _input;
        } else if (_parameter == PARAMETER.PAYOUT) {// 1
            require(_input <= 1000, "Payout cannot be above 1 percent");
            terms.maxPayout = _input;
        } else if (_parameter == PARAMETER.DEBT) {// 2
            terms.maxDebt = _input;
        }
    }

    /**
     *  @notice set control variable adjustment
     *  @param _addition bool
     *  @param _increment uint
     *  @param _target uint
     *  @param _buffer uint
     */
    function setAdjustment(
        bool _addition,
        uint256 _increment,
        uint256 _target,
        uint256 _buffer
    ) external onlyBondManager {
        require(_increment <= terms.controlVariable.mul(30).div(1000), "Increment too large");
        require(_target > 0, "setAdjustment: target greater than 0");

        adjustment = Adjust({
            add: _addition,
            rate: _increment,
            target: _target,
            buffer: _buffer,
            lastBlock: block.number
        });
    }

    /**
     *  @notice change address of Treasury
     *  @param _olyTreasury uint
     */
    function changeOlyTreasury(address _olyTreasury) external {
        address dao = Fees(FEES).DAO();
        require(msg.sender == dao, "changeOlyTreasury: Only DAO can replace OLY_TREASURY");
        OLY_TREASURY = _olyTreasury;
    }

    /**
     *  @notice subsidy controller checks payouts since last subsidy and resets counter
     *  @return payoutSinceLastSubsidy_ uint
     */
    function paySubsidy() external returns (uint256 payoutSinceLastSubsidy_) {
        require(msg.sender == SUBSIDY_ROUTER, "Only subsidy controller");

        payoutSinceLastSubsidy_ = payoutSinceLastSubsidy;
        payoutSinceLastSubsidy = 0;
    }

    /* ======== USER FUNCTIONS ======== */

    /**
     *  @notice deposit bond
     *  @param _amount uint
     *  @param _maxPrice uint
     *  @param _depositor address
     *  @return uint
     */
    function deposit(
        uint256 _amount,
        uint256 _maxPrice,
        address _depositor
    ) external returns (uint256) {
        require(_depositor != address(0), "Invalid address");

        return __deposit(_amount, _maxPrice, principalToken, _depositor, true);
    }

    /**
     *  @notice deposit bond with an asset(i.e: USDT)
     *  @param _depositAmount amount of deposit asset
     *  @param _depositAsset deposit asset
     *  @param _incomingAsset asset address for swap from deposit asset
     *  @param _depositor address of depositor
     *  @return uint
     */
    function depositWithAsset(
        uint256 _depositAmount,
        uint256 _maxPrice,
        address _depositAsset,
        address _incomingAsset,
        address _depositor
    ) external returns (uint256) {
        require(_depositor != address(0), "depositWithAsset: Invalid depositor");

        (address lpAddress, uint256 lpAmount) = __lpAddressAndAmount(_depositAmount, _depositAsset, _incomingAsset);

        // remain payoutToken is transferred to user
        __transferAssetToCaller(msg.sender, address(PAYOUT_TOKEN));

        require(lpAddress != address(0), "depositWithAsset: Invalid lpAddress");

        require(lpAmount > 0, "depositWithAsset: Insufficient lpAmount");

        return __deposit(lpAmount, _maxPrice, lpAddress, _depositor, false);
    }


    /// @notice internal process of deposit()
    /// @param _lpAmount amount of principleToken
    /// @param _maxPrice amount
    /// @param _lpAddress principleToken
    /// @param _depositor address of depositor
    /// @param _flag if deposit(), true and if depositWithAsset(), false
    /// @return uint
    function __deposit(
        uint256 _lpAmount,
        uint256 _maxPrice,
        address _lpAddress,
        address _depositor,
        bool _flag
    ) internal returns (uint256) {
        
        decayDebt();
        
        require(totalDebt <= terms.maxDebt, "Max capacity reached");

        uint256 nativePrice = trueBondPrice();

        require(_maxPrice >= nativePrice, "Slippage limit: more than max price"); // slippage protection

        uint256 value = CUSTOM_TREASURY.valueOfToken(_lpAddress, _lpAmount);
        uint256 payout = _payoutFor(value); // payout to bonder is computed

        // must be > 0.01 payout token ( underflow protection )
        require(payout >= 10**PAYOUT_TOKEN.decimals() / 100, "Bond too small");

        require(payout <= maxPayout(), "Bond too large"); // size protection because there is no slippage

        // principal is transferred in
        // approved and deposited into the treasury, returning (_amount - profit) payout token
         if(_flag) {
            IERC20(_lpAddress).safeTransferFrom(msg.sender, address(this), _lpAmount);
         }

        // profits are calculated
        uint256 fee;

        // principal is been taken as fee and trasfered to dao
        if (lpTokenAsFeeFlag) {
            fee = _lpAmount.mul(currentFluxFee()).div(1e6);
            if (fee != 0) {
                IERC20(_lpAddress).transfer(OLY_TREASURY, fee);
            }
        } else {
            fee = payout.mul(currentFluxFee()).div(1e6);
        }

        IERC20(_lpAddress).approve(address(CUSTOM_TREASURY), _lpAmount);
        CUSTOM_TREASURY.deposit(_lpAddress, _lpAmount.sub(fee), payout);

        if (!lpTokenAsFeeFlag && fee != 0) { // fee is transferred to dao
            PAYOUT_TOKEN.transfer(OLY_TREASURY, fee);
        }

        // total debt is increased
        totalDebt = totalDebt.add(value);

        // depositor info is stored
        if(lpTokenAsFeeFlag){
            bondInfo[_depositor] = Bond({
                payout: bondInfo[_depositor].payout.add(payout),
                vesting: terms.vestingTerm,
                lastBlock: block.number,
                truePricePaid: trueBondPrice()
            });
        } else {
            bondInfo[_depositor] = Bond({
                payout: bondInfo[_depositor].payout.add(payout.sub(fee)),
                vesting: terms.vestingTerm,
                lastBlock: block.number,
                truePricePaid: trueBondPrice()
            });
        }

        // indexed events are emitted
        emit BondCreated(_lpAmount, payout, block.number.add(terms.vestingTerm));
        emit BondPriceChanged(_bondPrice(), debtRatio());

        totalPrincipalBonded = totalPrincipalBonded.add(_lpAmount); // total bonded increased
        totalPayoutGiven = totalPayoutGiven.add(payout); // total payout increased
        payoutSinceLastSubsidy = payoutSinceLastSubsidy.add(payout); // subsidy counter increased

        adjust(); // control variable is adjusted
        return payout;
    }

    /**
     *  @notice redeem bond for user
     *  @return uint
     */
    function redeem(address _depositor) external returns (uint) {
        Bond memory info = bondInfo[_depositor];

        uint percentVested = percentVestedFor(_depositor); // (blocks since last interaction / vesting term remaining)

        if (percentVested >= 10000) { // if fully vested
            delete bondInfo[_depositor]; // delete user info
            emit BondRedeemed(_depositor, info.payout, 0); // emit bond data

            if(info.payout > 0) {
                PAYOUT_TOKEN.transfer(_depositor, info.payout);
            }

            return info.payout;
        } else { // if unfinished
            // calculate payout vested
            uint256 payout = info.payout.mul(percentVested).div(10000);

            // store updated deposit info
            bondInfo[_depositor] = Bond({
                payout: info.payout.sub(payout),
                vesting: info.vesting.sub(block.number.sub(info.lastBlock)),
                lastBlock: block.number,
                truePricePaid: info.truePricePaid
            });

            emit BondRedeemed(_depositor, payout, bondInfo[_depositor].payout);

            if(payout > 0) {
                PAYOUT_TOKEN.transfer(_depositor, payout);
            }

            return payout;
        }
    }

    /* ======== INTERNAL HELPER FUNCTIONS ======== */

    /// @notice makes incremental adjustment to control variable
    function adjust() internal {
        uint256 blockCanAdjust = adjustment.lastBlock.add(adjustment.buffer);
        if (adjustment.rate != 0 && block.number >= blockCanAdjust) {
            uint256 initial = terms.controlVariable;
            if (adjustment.add) {
                terms.controlVariable = terms.controlVariable.add(adjustment.rate);
                if (terms.controlVariable >= adjustment.target) {
                    adjustment.rate = 0;
                }
            } else {
                terms.controlVariable = terms.controlVariable.sub(adjustment.rate);
                if (terms.controlVariable <= adjustment.target) {
                    adjustment.rate = 0;
                }
            }
            adjustment.lastBlock = block.number;
            
            emit ControlVariableAdjustment(initial, terms.controlVariable, adjustment.rate, adjustment.add);
        }
    }

    /**
     *  @notice reduce total debt
     */
    function decayDebt() internal {
        totalDebt = totalDebt.sub(debtDecay());
        lastDecay = block.number;
    }

    /**
     *  @notice calculate current bond price and remove floor if above
     *  @return price_ uint
     */
    function _bondPrice() internal returns (uint256 price_) {
        price_ = terms.controlVariable.mul(debtRatio()).div(10**(uint256(PAYOUT_TOKEN.decimals()).sub(5)));
        if (price_ < terms.minimumPrice) {
            price_ = terms.minimumPrice;
        } else if (terms.minimumPrice != 0) {
            terms.minimumPrice = 0;
        }
    }

    /* ======== VIEW FUNCTIONS ======== */

    /**
     *  @notice calculate current bond premium
     *  @return price_ uint
     */
    function bondPrice() public view returns (uint256 price_) {
        price_ = terms.controlVariable.mul(debtRatio()).div(10**(uint256(PAYOUT_TOKEN.decimals()).sub(5)));
        if (price_ < terms.minimumPrice) {
            price_ = terms.minimumPrice;
        }
    }

    /**
     *  @notice calculate true bond price a user pays
     *  @return price_ uint
     */
    function trueBondPrice() public view returns (uint256 price_) {
        price_ = bondPrice().add(bondPrice().mul(currentFluxFee()).div(1e6));
    }

    /**
     *  @notice determine maximum bond size
     *  @return uint
     */
    function maxPayout() public view returns (uint) {
        uint256 totalSupply = PAYOUT_TOKEN.totalSupply();
        if(totalSupply > 10**18*10**PAYOUT_TOKEN.decimals()) totalSupply = 10**18*10**PAYOUT_TOKEN.decimals();
        return totalSupply.mul(terms.maxPayout).div(100000);
    }

    /**
     *  @notice calculate total interest due for new bond
     *  @param _value uint
     *  @return uint
     */
    function _payoutFor(uint256 _value) internal view returns (uint256) {
        return FixedPoint.fraction(_value, bondPrice()).decode112with18().div(1e11);
    }

    /**
     *  @notice calculate user's interest due for new bond, accounting for Flux Fee
     *  @param _value uint
     *  @return uint
     */
    function payoutFor(uint256 _value) external view returns (uint256) {
        uint256 total = FixedPoint.fraction(_value, bondPrice()).decode112with18().div(1e11);
        return total.sub(total.mul(currentFluxFee()).div(1e6));
    }

    /**
     *  @notice calculate current ratio of debt to payout token supply
     *  @notice protocols using Flux Pro should be careful when quickly adding large %s to total supply
     *  @return debtRatio_ uint
     */
    function debtRatio() public view returns (uint256 debtRatio_) {
        debtRatio_ = FixedPoint
            .fraction(currentDebt().mul(10**PAYOUT_TOKEN.decimals()), PAYOUT_TOKEN.totalSupply())
            .decode112with18()
            .div(1e18);
    }

    /**
     *  @notice calculate debt factoring in decay
     *  @return uint
     */
    function currentDebt() public view returns (uint256) {
        return totalDebt.sub(debtDecay());
    }

    /**
     *  @notice amount to decay total debt by
     *  @return decay_ uint
     */
    function debtDecay() public view returns (uint256 decay_) {
        uint256 blocksSinceLast = block.number.sub(lastDecay);
        decay_ = totalDebt.mul(blocksSinceLast).div(terms.vestingTerm);
        if (decay_ > totalDebt) {
            decay_ = totalDebt;
        }
    }

    /**
     *  @notice calculate how far into vesting a depositor is
     *  @param _depositor address
     *  @return percentVested_ uint
     */
    function percentVestedFor(address _depositor) public view returns (uint256 percentVested_) {
        Bond memory bond = bondInfo[_depositor];
        uint256 blocksSinceLast = block.number.sub(bond.lastBlock);
        uint256 vesting = bond.vesting;

        if (vesting > 0) {
            percentVested_ = blocksSinceLast.mul(10000).div(vesting);
        } else {
            percentVested_ = 0;
        }
    }

    /**
     *  @notice calculate amount of payout token available for claim by depositor
     *  @param _depositor address
     *  @return pendingPayout_ uint
     */
    function pendingPayoutFor(address _depositor) external view returns (uint256 pendingPayout_) {
        uint256 percentVested = percentVestedFor(_depositor);
        uint256 payout = bondInfo[_depositor].payout;

        if (percentVested >= 10000) {
            pendingPayout_ = payout;
        } else {
            pendingPayout_ = payout.mul(percentVested).div(10000);
        }
    }

    /**
     *  @notice current fee Flux takes of each bond
     *  @return currentFee_ uint
     */
    function currentFluxFee() public view returns (uint256 currentFee_) {

        uint256[] memory tierCeilings = Fees(FEES).getTierCeilings();
        uint256[] memory fees = Fees(FEES).getFees();

        uint256 feesLength = fees.length;
        for (uint256 i; i < feesLength; i++) {
            if (totalPrincipalBonded < tierCeilings[i] || i == feesLength - 1) {
                if(fees[i] > maxFeeAllowed){
                    return maxFeeAllowed;
                }else{
                    return fees[i];
                }

            }
        }
    }

    /// @dev Helper to transfer full contract balances of assets to the caller
    function __transferAssetToCaller(address _caller, address _asset) private {
        uint256 transferAmount = IERC20(_asset).balanceOf(address(this));
        if (transferAmount > 0) {
            IERC20(_asset).safeTransfer(_caller, transferAmount);
        }
    }

    /// @notice Swap and AddLiquidity on the UniswapV2
    function __lpAddressAndAmount(
        uint256 _depositAmount,
        address _depositAsset,
        address _incomingAsset
    ) public payable returns (address lpAddress_, uint256 lpAmount_) {

        if(_depositAsset == address(0)) {//ETH
            payable(address(HELPER)).transfer(address(this).balance);
        } else {
            IERC20(_depositAsset).safeTransferFrom(msg.sender, address(this), _depositAmount);

            IERC20(_depositAsset).approve(address(HELPER), _depositAmount);
        }

        bytes memory swapArgs = abi.encode(_depositAmount, _depositAsset, address(PAYOUT_TOKEN), _incomingAsset);

        (lpAddress_, lpAmount_) = IHelper(HELPER).swapForDeposit(swapArgs);

        emit LPAdded(lpAddress_, lpAmount_);
    }
}
