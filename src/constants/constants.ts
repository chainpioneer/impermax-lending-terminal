import axios from 'axios'
import Web3 from 'web3'

export enum Chains {
  BASE = 'BASE',
  OP = 'OP',
  SCROLL = 'SCROLL',
  FTM = 'FTM',
}

export enum ASSETS {
  USDC = 'USDC',
  ETH = 'ETH',
  FTM = 'FTM',
  wstETH = 'wstETH',
  OP = 'OP',
}

export const web3Inst = new Web3('')

export const CHAIN_CONF: {
  [key in Chains]: {
    rpcUrls: string[]
    borrowables: string[]
    chainId: number
    assets: { [addr: string]: ASSETS }
  }
} = {
  [Chains.BASE]: {
    borrowables: [
      web3Inst.utils.toChecksumAddress('0x271dbacca7b447db75d4751ecb7fc3dab4910916'),
      web3Inst.utils.toChecksumAddress('0x60a86B077843F9E6cda580782EA3CCB8E2B8794c'),
      web3Inst.utils.toChecksumAddress('0xd3c4eda1f275bb95d960621a747ab6bbacb6694a'),
      web3Inst.utils.toChecksumAddress('0x8fb8e02fce8eb1ade5213564140090df7b5ab1b5'),
      web3Inst.utils.toChecksumAddress('0xb72b27daf51d83b238c43f7d7ce6b461a774249b'),
      web3Inst.utils.toChecksumAddress('0x4ddA3Ae5576B7D5B42626D671d1Ae738716bc459'),
      web3Inst.utils.toChecksumAddress('0x04db41d3afbaa587bef2baa23ee383631196f243'),
      web3Inst.utils.toChecksumAddress('0xbebc60ca78147c04ede280f7f46777e8cf139924'),
      web3Inst.utils.toChecksumAddress('0xe43872854ce04be138a81a383901c8d6f55c5b20'),
    ],
    rpcUrls: ['https://mainnet.base.org', 'https://1rpc.io/base', 'https://base.meowrpc.com'],
    chainId: 8453,
    assets: {
      '0x4200000000000000000000000000000000000006': ASSETS.ETH,
      '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452': ASSETS.wstETH,
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913': ASSETS.USDC,
    },
  },
  [Chains.OP]: {
    borrowables: [
      web3Inst.utils.toChecksumAddress('0x0fac6BBfc6d56E1B7ABEB58fD437017603Ed731f'),
      web3Inst.utils.toChecksumAddress('0xf57fcaacb6ac3f9b5a630c315e7fbd638914375c'),
      web3Inst.utils.toChecksumAddress('0x583460f3b6ed8b20ed153b4fd20fd12efa7e3ee1'),
      web3Inst.utils.toChecksumAddress('0x2a503f2c408ee24e13b33a08446478d5cef70d3c'),
      web3Inst.utils.toChecksumAddress('0x6E370804181b2B5f9090C152CC87f687c0f635F3'),
      web3Inst.utils.toChecksumAddress('0x65d62988a06bda35f9b16c0f5a5541c100989dbb'),
      web3Inst.utils.toChecksumAddress('0xfacdd4a72b110be8f193ebdb0ba66196955d919e'),
      web3Inst.utils.toChecksumAddress('0x388a16D05b5eB4BB4c6D6f841544c6138219dF53'),
      web3Inst.utils.toChecksumAddress('0x261a84Bb62A1d10006711746dd8a5cB7eDc3F41d'),
    ],
    rpcUrls: ['https://mainnet.optimism.io', 'https://1rpc.io/op'],
    chainId: 10,
    assets: {
      '0x4200000000000000000000000000000000000006': ASSETS.ETH,
      '0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb': ASSETS.wstETH,
      '0x7F5c764cBc14f9669B88837ca1490cCa17c31607': ASSETS.USDC,
      '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85': ASSETS.USDC,
      '0x4200000000000000000000000000000000000042': ASSETS.OP,
    },
  },
  [Chains.SCROLL]: {
    borrowables: [
      web3Inst.utils.toChecksumAddress('0x261c172cba86b745c46060f856a64bd2dd9d2fd0'),
      web3Inst.utils.toChecksumAddress('0x56F98d1f75a6345312bf46FDb48aB4728Ff25aDf'),
      web3Inst.utils.toChecksumAddress('0x5fcB13b257bFB6A4Fdd4A263CBbfcF487FAd6aa3'),
      web3Inst.utils.toChecksumAddress('0x48305bF15D7002b07f94F52265bdFee36cAA84EA'),
      web3Inst.utils.toChecksumAddress('0x6bb698fcfec8BC3cfF098Fef50e48A3712cb5F2B'),
      web3Inst.utils.toChecksumAddress('0x89B3935F37127294c1C100D159C0849e2f58104A'),
      web3Inst.utils.toChecksumAddress('0x79e7674413855e01690cc7e078d64a71c1cf44c6'),
      web3Inst.utils.toChecksumAddress('0x8509212569bbAcFD254753257Ed6f01010B96D6b'),
      web3Inst.utils.toChecksumAddress('0xf92Fe79d269C3C315973dFcda7D748B1e506991B'),
      web3Inst.utils.toChecksumAddress('0x382B611B67169Da69D5073746b4EF94cd45Ef620'),
      web3Inst.utils.toChecksumAddress('0x38581cD06888569e157ae68d8DF64bD4f48B9eb1'),
    ],
    rpcUrls: ['https://rpc.scroll.io', 'https://1rpc.io/scroll', 'https://rpc.ankr.com/scroll', ],
    chainId: 534352,
    assets: {
      '0x5300000000000000000000000000000000000004': ASSETS.ETH,
      '0xf610A9dfB7C89644979b4A0f27063E9e7d7Cda32': ASSETS.wstETH,
      '0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4': ASSETS.USDC,
    },
  },
  [Chains.FTM]: {
    borrowables: [
      web3Inst.utils.toChecksumAddress('0x9691e8e395b9464f09f486100f5c8ef0136f1fa0'),
      web3Inst.utils.toChecksumAddress('0xb18b1a77b4c36fae9692a5b02bc4b9df4282396c'),
      web3Inst.utils.toChecksumAddress('0xf7d5b28eb3f77a2c0345cbcf73f698837c3223dc'),
      web3Inst.utils.toChecksumAddress('0x9351d443baa89c1597d032557d66a49bfc32c47e'),
      web3Inst.utils.toChecksumAddress('0x948fa788924e8e2a211b22bc0a04c6702c5905f5'),
      web3Inst.utils.toChecksumAddress('0x92ef7a8bbd2911be251452a3147a5505ad8fa08f'),
      web3Inst.utils.toChecksumAddress('0xa5aaa4d6d52e8ab2ef7a6398db552d14b80a6b1f'),
      web3Inst.utils.toChecksumAddress('0x904458d79424d2353e8d93e2cc9dfb4e04629794'),
      web3Inst.utils.toChecksumAddress('0xbe5f69e03c7a38e277ff4b0e270e095bdca47bb6'),
      web3Inst.utils.toChecksumAddress('0x388e0f873ea0d301223d027394f2e8272a38437a'),
      web3Inst.utils.toChecksumAddress('0x7a3c737368d9ab8f00e19fe58cdad7aed586cd49'),
      web3Inst.utils.toChecksumAddress('0xab0de337fe170bb8c8d88664641402b1da410cd7'),
    ],
    rpcUrls: ['https://fantom-json-rpc.stakely.io', 'https://fantom-mainnet.public.blastapi.io', 'https://endpoints.omniatech.io/v1/fantom/mainnet/public', 'https://fantom.drpc.org', 'https://1rpc.io/ftm', 'https://rpc.ftm.tools', 'https://rpc.fantom.network', 'https://rpc.ankr.com/fantom', 'https://rpcapi.fantom.network', 'https://rpc2.fantom.network'],
    chainId: 250,
    assets: {
      '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83': ASSETS.FTM,
    },
  },
}

const assetPrices: { [key: string]: number } = {
  [ASSETS.USDC]: 1.0,
}

export async function getAssetPrice(asset: ASSETS) {
  if (assetPrices[asset] !== undefined) {
    return assetPrices[asset]
  }
  let url

  switch (asset) {
    case ASSETS.ETH: {
      url = 'https://api.coinbase.com/v2/prices/ETH-USD/spot'
      break
    }
    case ASSETS.wstETH: {
      url = 'https://api.coinbase.com/v2/prices/wstETH-USD/spot'
      break
    }
    case ASSETS.OP: {
      url = 'https://api.coinbase.com/v2/prices/OP-USD/spot'
      break
    }
    case ASSETS.FTM: {
      url = 'https://api.coinbase.com/v2/prices/FTM-USD/spot'
      break
    }
    default:
      throw new Error(`unable to fetch price:: unknown asset ${asset}`)
  }
  const res = (await axios.get(url)).data.data
  assetPrices[asset] = Number(res.amount)

  return assetPrices[asset]
}
