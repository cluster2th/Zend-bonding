import {expect} from './chai-setup';
import {ethers, deployments} from 'hardhat';
import {setupUsers, config, randomAddress} from './utils';
import {Factory, FactoryStorage, Helper, SubsidyRouter, MockToken} from '../typechain';
import { BigNumber, utils } from 'ethers';
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
import { Fees } from '../typechain/Fees';
const ERC20 = require('./utils/ERC20.json');

// TEST : Rinkeby testnet
const setup = deployments.createFixture(async () => {
  await deployments.fixture('Factory');
  
  const contracts = {
    FactoryContract: <Factory>await ethers.getContract('Factory'),
    FactoryStorageContract: <FactoryStorage>await ethers.getContract('FactoryStorage'),
    SubsidyRouterContract: <SubsidyRouter>await ethers.getContract('SubsidyRouter'),
    HelperContract: <Helper>await ethers.getContract('Helper'),
    FeesContract: <Fees>await ethers.getContract('Fees'),
    MockTokenContract: <MockToken>await ethers.getContract('MockToken'),
  };  
  
  const [deployer, dao, user, user2, user3, user4] = await ethers.getSigners();
  //dao = 0x6fD89350A94A02B003E638c889b54DAB0E251655
  const private_key = process.env.PRIVATE_KEY;
  return {
    ...contracts, deployer, dao, user, user2, user3, user4, private_key
  };
});

const convert = (addr: string) => {
  return addr.toLowerCase();
}

describe('Whole flow with principleToken', async function () {
  it('setFees(dao), createBond(deployer), deposit(user1,2,3), redeem(user3)', async function () {      
    const {
      deployer, dao, user, user2, user3,
      FactoryContract,
      FactoryStorageContract,
      FeesContract,
      MockTokenContract
    } = await setup();

    let events: any = [];
    const principleToken = await MockTokenContract.deployed();//decimal=18, usdc decimal=6

    let feesTx = await FeesContract.connect(dao).setTiersAndFees(config.tierCeilings, config.fees, {from: dao.address});
    events = (await feesTx.wait()).events; 
    const tierCeilings = events[0].args.tierCeilings;
    const fees = events[0].args.fees;
    console.log("====tierCeilings, fees", Number(tierCeilings[0]), Number(fees[0]));
    expect(Number(config.fees[0])).to.equal(Number(fees[0]));

    const tx = await FactoryContract.connect(deployer).createBondAndTreasury(
      config.usdcAdress,      // payoutToken
      principleToken.address, // principleToken(LP token)
      deployer.address, 
      {from: deployer.address}
    )

    const TreasuryFactory = await ethers.getContractFactory('CustomTreasury');
    const BondFactory = await ethers.getContractFactory('CustomBond');

    events = (await tx.wait()).events; 
    const customTreasuryAddr = events[0].args.treasury;
    const customBondAddr = events[0].args.bond;
    const TreasuryContract = TreasuryFactory.attach(customTreasuryAddr);
    const BondContract = BondFactory.attach(customBondAddr);
    console.log("====BondAddr, TreasuryAddr", customBondAddr, customTreasuryAddr);

    // Test emit-NewBond of pushBond
    await expect(
      FactoryContract.createBondAndTreasury(
        config.usdcAdress,      // payoutToken
        principleToken.address, // principleToken(LP token)
        deployer.address, 
        {from: deployer.address}
      )
    ).to.emit(FactoryStorageContract, 'NewBond').withArgs('0x7ecbfa6ffcbE3411b21b0271faE77a0E3E300F56', '0x074F7bf0Be53c1267656dd43229Ca5dA30F8845a', deployer.address);

    // pushBond
    const push_tx = FactoryStorageContract.connect(deployer).pushBond(
      config.usdcAdress,
      principleToken.address,
      customTreasuryAddr,
      customBondAddr,
      deployer.address, 
      {from: deployer.address}
    );
    await expect(push_tx).to.be.revertedWith('Not Factory');

    // bondDetailsCount
    const bond_count_tx = await FactoryStorageContract.connect(deployer).bondDetailsCount({from: deployer.address});
    console.log("====bondCount::", Number(bond_count_tx));

    // initialization bond
    const controlVariable = BigNumber.from(50000);// > 0
    const vestingTerm = BigNumber.from(10200);
    const minimumPrice = BigNumber.from(36760);
    const maxPayout = BigNumber.from(40);// 0.04% 
    const maxDebt = utils.parseEther('1250');
    const initialDebt = utils.parseEther('400');//400000000000000000000

    await expect(BondContract.connect(deployer).initializeBond(0, vestingTerm, minimumPrice, maxPayout, maxDebt, initialDebt, {from: deployer.address})).to.be.revertedWith('initializeBond: controlVariable must be 0');

    await expect(BondContract.connect(deployer).initializeBond(controlVariable, 1000, minimumPrice, maxPayout, maxDebt, initialDebt, {from: deployer.address})).to.be.revertedWith('Vesting must be longer than 36 hours');

    await BondContract.connect(deployer).initializeBond(controlVariable, vestingTerm, minimumPrice, maxPayout, maxDebt, initialDebt, {from: deployer.address})
        
    //Approve(principleToken) to deposit in frontend(user)
    const tokenSupply = await principleToken.totalSupply();//1e+26
    await principleToken.connect(deployer).approve(BondContract.address, tokenSupply, {from: deployer.address});
    
    // Transfer(payoutToken) to TreasuryContract for testing
    const payoutTokenContract = new ethers.Contract(config.usdcAdress, JSON.stringify(ERC20), ethers.provider)
    const payoutBalance = await payoutTokenContract.balanceOf(deployer.address)
    // console.log("====payoutBalance::", Number(BigNumber.from(payoutBalance)));//57297
    const transferAmount = utils.parseUnits('57000', await payoutTokenContract.decimals());//33333333333
    await payoutTokenContract.connect(deployer).transfer(TreasuryContract.address, transferAmount, {from: deployer.address});
    
    const amount = utils.parseUnits('10', await principleToken.decimals()); 
    const maxPrice = BigNumber.from(50000);   

    const addition = true;
    const increment = controlVariable.mul(2).div(100);//1600
    const target = controlVariable.div(20);//4000
    const buffer = 0;
    await BondContract.connect(deployer).setAdjustment(addition, increment, target, buffer, {from: deployer.address});




    //============================ owner(deployer) deposit()
    const txd = await BondContract.connect(deployer).deposit(amount, maxPrice, user.address, {from:deployer.address});
    events = (await txd.wait()).events;  
    let bondCreatedEvent = events[7].args;
    const deposit = Number(BigNumber.from(bondCreatedEvent.deposit))
    const payout = Number(BigNumber.from(bondCreatedEvent.payout))
    const expires = Number(BigNumber.from(bondCreatedEvent.expires))
    console.log("====emit::", payout, expires);
    expect(Number(amount)).to.equal(deposit);

    const nativePrice = await BondContract.connect(deployer).trueBondPrice({from: deployer.address});
    console.log("====nativePrice::", Number(nativePrice));
    const value = await TreasuryContract.connect(deployer).valueOfToken(principleToken.address, amount, {from: deployer.address});
    console.log("====value::", Number(value));
    const maxPayoutTx = await BondContract.connect(deployer).maxPayout({from: deployer.address});
    console.log("====maxPayout::", Number(maxPayoutTx));

    const blockNum = await ethers.provider.getBlockNumber()
    const expiresSol = BigNumber.from(blockNum).add(vestingTerm);
    expect(Number(expiresSol)).to.equal(expires);
    
    let bondPriceChangedEvent = events[8].args;
    const internalPrice = Number(BigNumber.from(bondPriceChangedEvent.internalPrice))
    const debtRatio = Number(BigNumber.from(bondPriceChangedEvent.debtRatio))
    console.log("====emit-1::", internalPrice, debtRatio);

    const debtRatioSol = await BondContract.connect(deployer).debtRatio({from:deployer.address});
    expect(Number(debtRatioSol)).to.equal(debtRatio)

    // debtRatio=0 so that price = terms.minimumPrice;
    const priceSol = minimumPrice;
    expect(Number(priceSol)).to.equal(internalPrice)
    


    

    //========================== user deposit
    await principleToken.connect(deployer).transfer(user.address, utils.parseUnits('200', await principleToken.decimals()), {from: deployer.address});
            
    //Approve(principleToken) to deposit in frontend(user)
    await principleToken.connect(user).approve(BondContract.address, tokenSupply, {from: user.address});
        
    // deposit()
    const txd_u = await BondContract.connect(user).deposit(amount.mul(2), maxPrice, user.address, {from:user.address});
    events = (await txd_u.wait()).events;   
    bondCreatedEvent = events[7].args;
    const deposit_u = Number(BigNumber.from(bondCreatedEvent.deposit))
    const payout_u = Number(BigNumber.from(bondCreatedEvent.payout))
    const expires_u = Number(BigNumber.from(bondCreatedEvent.expires))
    console.log("====1 deposit, payout, expires::", deposit_u, payout_u, expires_u);
    expect(Number(amount.mul(2))).to.equal(deposit_u);
    
    bondPriceChangedEvent = events[8].args;
    const internalPrice_u = Number(BigNumber.from(bondPriceChangedEvent.internalPrice))
    const debtRatio_u = Number(BigNumber.from(bondPriceChangedEvent.debtRatio))
    console.log("====1 internalPrice, debtRatio::", internalPrice_u, debtRatio_u);




    //========================== user2 deposit
    await principleToken.connect(deployer).transfer(user2.address, utils.parseUnits('200', await principleToken.decimals()), {from: deployer.address});
            
    //Approve(principleToken) to deposit in frontend(user)
    await principleToken.connect(user2).approve(BondContract.address, tokenSupply, {from: user2.address});
        
    // deposit()
    const txd_u2 = await BondContract.connect(user2).deposit(amount.mul(3), maxPrice, user2.address, {from:user2.address});
    events = (await txd_u2.wait()).events;   
    bondCreatedEvent = events[7].args;
    const deposit_u2 = Number(BigNumber.from(bondCreatedEvent.deposit))
    const payout_u2 = Number(BigNumber.from(bondCreatedEvent.payout))
    const expires_u2 = Number(BigNumber.from(bondCreatedEvent.expires))
    console.log("====2 deposit, payout, expires::", deposit_u2, payout_u2, expires_u2);
    expect(Number(amount.mul(3))).to.equal(deposit_u2);
    
    bondPriceChangedEvent = events[8].args;
    const internalPrice_u2 = Number(BigNumber.from(bondPriceChangedEvent.internalPrice))
    const debtRatio_u2 = Number(BigNumber.from(bondPriceChangedEvent.debtRatio))
    console.log("====2 internalPrice, debtRatio::", internalPrice_u2, debtRatio_u2);


    

    //========================== user3 deposit
    // set fees and feeTiers again
    const feessss = [20000];
    const tierCeilingssss = [0];
    feesTx = await FeesContract.connect(dao).setTiersAndFees(tierCeilingssss, feessss, {from: dao.address});
    events = (await feesTx.wait()).events; 
    const tierCeilings_val = events[0].args.tierCeilings;
    const fees_val = events[0].args.fees;
    console.log("====again fees, tierCeilings", Number(tierCeilings_val[0]), Number(fees_val[0]));

    // Transfer LP from deployer to user3
    await principleToken.connect(deployer).transfer(user3.address, utils.parseUnits('200', await principleToken.decimals()), {from: deployer.address});
            
    // Approve(principleToken) to deposit in frontend(user)
    await principleToken.connect(user3).approve(BondContract.address, tokenSupply, {from: user3.address});
        
    // deposit()
    const txd_u3 = await BondContract.connect(user3).deposit(amount.mul(4), maxPrice, user3.address, {from:user3.address});
    events = (await txd_u3.wait()).events;   
    bondCreatedEvent = events[7].args;
    const deposit_u3 = Number(BigNumber.from(bondCreatedEvent.deposit))
    const payout_u3 = Number(BigNumber.from(bondCreatedEvent.payout))
    const expires_u3 = Number(BigNumber.from(bondCreatedEvent.expires))
    console.log("====3 deposit, payout, expires::", deposit_u3, payout_u3, expires_u3);
    expect(Number(amount.mul(4))).to.equal(deposit_u3);
    
    bondPriceChangedEvent = events[8].args;
    const internalPrice_u3 = Number(BigNumber.from(bondPriceChangedEvent.internalPrice))
    const debtRatio_u3 = Number(BigNumber.from(bondPriceChangedEvent.debtRatio))
    console.log("====3 internalPrice, debtRatio::", internalPrice_u3, debtRatio_u3);

    const tx_fee = await BondContract.connect(user3).currentFluxFee({from: user3.address});
    console.log("===================3 currentFluxFee::", Number(tx_fee));


    //======================================= redeem
    // Set timestamp
    const currentDate = new Date()
    const afterFiveDays = new Date(currentDate.setDate(currentDate.getDate() + 5))
    const afterFiveDaysTimeStampUTC = new Date(afterFiveDays.toUTCString()).getTime() / 1000
    await ethers.provider.send("evm_setNextBlockTimestamp", [afterFiveDaysTimeStampUTC])
    await ethers.provider.send("evm_mine", [])

    let payoutTokenBalanceToUserBeforeRedeem = Number(await payoutTokenContract.balanceOf(user3.address));
    console.log("====BeforeRedeem::", payoutTokenBalanceToUserBeforeRedeem);

    const tx_r = await BondContract.connect(user3).redeem(user3.address, {from: user3.address})
    events = (await tx_r.wait()).events
    const recipient = events[0].args.recipient;
    const payoutRedeem = events[0].args.payout;
    const remaining = events[0].args.remaining;
    
    const payoutTokenBalanceToUserAfterRedeem = Number(await payoutTokenContract.balanceOf(user3.address));//500000000067203460
    console.log("====AfterRedeem::", payoutTokenBalanceToUserAfterRedeem);
    expect(payout_u3).to.equal(Number(remaining.add(payoutRedeem)));
    console.log("====recipient, user3::", recipient, user3.address)
    console.log("====payoutRedeem, remaining::", Number(payoutRedeem), Number(remaining))
  });
});

