// args from deployments 
// 0x5cBbA5484594598a660636eFb0A1AD953aFa4e32
// npx hardhat verify --network kovan 0x5cBbA5484594598a660636eFb0A1AD953aFa4e32 --constructor-args utils/verifyArgs.js

// === CustomBond
// npx hardhat verify --network rinkeby 0x8d1bcab2279f8be257657537e8cd6d6b4556642c --constructor-args utils/verifyArgs.js
// module.exports = [                    
//   "0x24ef8923a06a87b35479c56082d34665dcc27283", //_customTreasury
//   "0x4DBCdF9B62e891a7cec5A2568C3F4FAF9E8Abe2b", //_payoutToken
//   "0x3a9279f35f38fece18c9799ee3874d376ddeffeb",   //_principalToken
//   "0xc3Ab493d0d06c700d9daF7Ea58aBBe12038ec474", //_olyTreasury
//   "0xa1260b541f15514295ee0a6831189dc321cdec12", //_subsidyRouter
//   "0xb10bcC8B508174c761CFB1E7143bFE37c4fBC3a1", //_initialOwner
//   "0x6eeaeff2a5393f09b9d11b7d6489a3282a9ad28d", //_helper
//   "0x4ff15c53eda95f407f09c647af8028bbdaf9e1cb"  //_fees
// ];
// === CustomTreasury
// npx hardhat verify --network rinkeby 0x24ef8923a06a87b35479c56082d34665dcc27283 --constructor-args utils/verifyArgs.js
// module.exports = [                    
//   "0x4DBCdF9B62e891a7cec5A2568C3F4FAF9E8Abe2b", //payoutToken
//   "0xb10bcC8B508174c761CFB1E7143bFE37c4fBC3a1"  //initialOwner
// ];

// === Mock Token(EXM)
// npx hardhat verify --network rinkeby 0x6dB7315f4A296E47Eee37Ebb6871091dF5c2c40F --constructor-args utils/verifyArgs.js
module.exports = [                    
  "Mock Token",
  "EXM",
  18
];