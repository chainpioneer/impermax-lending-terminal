import {Call, Contract} from 'ethcall'

import borrowableAbi from '../../abi/borrowable.json' assert {type: 'json'}
import vaultAbi from '../../abi/vault.json' assert {type: 'json'}
import collateralAbi from '../../abi/collateral.json' assert {type: 'json'}
import {ASSETS, CHAIN_CONF, Chains} from '../constants/constants'
import {callWithTimeout, getCurrentEthCallProvider, tryWithTimeout, web3EthCall} from '../provider/provider'
import ONE from '../utils/ONE'
import {getAssetPrice, waitForPrices} from "./assetPrices";

type AssetStats = {
  oldUserSupplied: number
  newUserSupplied: number
  newUserSuppliedUsd: number
  oldDailyEarnings: number
  oldDailyEarningsUsd: number
  newDailyEarnings: number
  maxDailyEarnings: number
  maxDailyEarningsUsd: number
  currentAPR: number
  maxAPR: number
}

type ChainStats = {
  newUserSuppliedUsd: number
  oldDailyEarningsUsd: number
  usd: number
  maxDailyEarningsUsd: number
  currentAPR: number
  maxAPR: number
}

type Deposit = {
  amount: number
  bn: bigint
  usd: number
}

type Pool = {
  borrowable: string
  platform: string
  supplied: number
  suppliedBN: bigint
  suppliedUsd: number
  kink: number
  utilization: number
  aprOld: number
  tvlUsd: number
  tvl: number
  aprNew: number
  earningsOld: number
  earningsNew: number
  earningsOldUsd: number
  earningsNewUsd: number
  availableToDeposit: number
  availableToDepositUsd: number
  vaultAPR: number | string
  chain: Chains
  asset: ASSETS
  oppositeSymbol: string
  vault: string
  stable: boolean
}

export default async function load(users: string[]) {

  await waitForPrices()
  const cumulativeValuesByChains: { [chain: string]: { [asset: string]: AssetStats } } = {}
  const chainAggregatedStats: { [chain: string]: ChainStats } = {}
  const cumulativeValuesByAsset: { [asset: string]: AssetStats } = {}
  const idleBalancesByAsset: { [asset: string]: Deposit } = {}
  const idleBalancesByChain: { [chain: string]: { [asset: string]:  Deposit } } = {}

  const idleBalancesByUser: { [user: string]: number } = {}
  const idleBalancesByAssetByUser: { [asset: string]:  { [user: string]: Deposit } } = {}
  const idleBalancesByChainByUser: { [chain: string]: { [user: string]: number } } = {}
  const idleBalancesByChainByAssetByUser: { [chain: string]: { [asset: string]:  { [user: string]: Deposit } } } = {}

  const suppliedByUser: { [user: string]: number } = {}
  const suppliedByAssetByUser: { [asset: string]: { [user: string]: Deposit } } = {}
  const suppliedByChainByUser: { [chain: string]: { [user: string]: number } } = {}
  const suppliedByChainByAssetByUser: { [chain: string]: { [asset: string]: { [user: string]: Deposit } } } = {}
  const suppliedByChainByAssetByBorrowableByUser: { [chain: string]: { [asset: string]: { [borrowable: string]: { [user: string]: Deposit } } } } = {}

  const pools: Pool[] = []

  const chains = Object.keys(CHAIN_CONF) as Chains[]

  async function callChain(chain: Chains) {
    cumulativeValuesByChains[chain] = {}
    chainAggregatedStats[chain] = {
      newUserSuppliedUsd: 0,
      currentAPR: 0,
      oldDailyEarningsUsd: 0,
      usd: 0,
      maxAPR: 0,
      maxDailyEarningsUsd: 0
    }
    idleBalancesByChain[chain] = {}
    idleBalancesByChainByAssetByUser[chain] = {}
    const blockStruct = await web3EthCall(chain, 'getBlock', ['latest', false])
    const blockNumber = Number(blockStruct.number)
    const pastBlockNumber = blockNumber - 100
    const blockTimestamp = Number(blockStruct.timestamp)
    const conf = CHAIN_CONF[chain as Chains]

    let callsPerBor = 0
    const calls: Call[] = []
    conf.borrowables.forEach((b, i) => {
      const bor = new Contract(b, borrowableAbi)
      calls.push(
        bor.collateral(),
        bor.underlying(),
        bor.totalBalance(),
        bor.totalBorrows(),
        bor.exchangeRateLast(),
        bor.borrowRate(),
        bor.sync(),
        bor.borrowRate(),
        bor.totalBalance(),
        bor.totalBorrows(),
        bor.exchangeRate(),
        bor.reserveFactor(),
        bor.name(),
        bor.kinkUtilizationRate(),
        ...users.map((u) => bor.balanceOf(u)),
      )
      if (i === 0) {
        callsPerBor = calls.length
      }
    })

    const borrowablesData = await callWithTimeout(chain, calls, blockNumber)

    const collaterals: string[] = []
    const underlyings: { [u: string]: true } = {}
    conf.borrowables.forEach((_, i) => {
      collaterals.push(borrowablesData[callsPerBor * i])
      underlyings[borrowablesData[callsPerBor * i + 1]] = true
    })

    const calls2: Call[] = []
    collaterals.forEach((c) => {
      const cc = new Contract(c, collateralAbi)
      calls2.push(cc.borrowable0(), cc.borrowable1(), cc.underlying())
    })

    const collateralResponse = await callWithTimeout(chain, calls2, blockNumber)
    const calls3: Call[] = []
    const vaultByBor: { [b: string]: string } = {}
    const stableByBor: { [b: string]: boolean } = {}
    collateralResponse.forEach((bu, i) => {
      const bIndex = Math.floor(i / 3)
      if (i % 3 === 2) { // underlying
        const vault = new Contract(bu, vaultAbi)
        calls3.push(vault.stable())
        calls3.push(vault.reinvest())
        calls3.push(vault.exchangeRate())
        calls3.push(vault.totalBalance())
        vaultByBor[conf.borrowables[bIndex]] = bu
      } else if (conf.borrowables[bIndex] !== bu) {
        // console.log(`${chain} borrowable ${bu} collateral ${collaterals[bIndex]}`)
        const borrowable2 = new Contract(bu, borrowableAbi)
        calls3.push(borrowable2.underlying())
        calls3.push(borrowable2.getBlockTimestamp())
      }
    })
    const oppositeUnderlyingsAndStableFlags = await tryWithTimeout(chain, calls3, pastBlockNumber, undefined, '0xcA11bde05977b3631167028862bE2a173976CA11')

    const pastVaultStateByBorrowable: { [b: string]: { timestamp: number, exchangeRate: bigint, totalBalance: bigint } } = {}

    const calls4: Call[] = []
    oppositeUnderlyingsAndStableFlags.forEach((val, i) => {
      switch (i % 6) {
        case 0:
          calls4.push(new Contract(val, borrowableAbi).symbol())
          const vault = new Contract(vaultByBor[conf.borrowables[Math.floor(i / 6)]], vaultAbi)
          calls4.push(vault.reinvest())
          calls4.push(vault.exchangeRate())
          calls4.push(vault.totalBalance())
          break
        case 1:
          pastVaultStateByBorrowable[conf.borrowables[Math.floor(i / 6)]] = { timestamp: Number(val), exchangeRate: oppositeUnderlyingsAndStableFlags[i + 3], totalBalance: oppositeUnderlyingsAndStableFlags[i + 4],  }
          break
        case 2:
          stableByBor[conf.borrowables[Math.floor(i / 6)]] = val
          break
        default:
          break
      }
    })

    users.forEach(u => {
      calls4.push(getCurrentEthCallProvider(chain).getEthBalance(u))
    })

    Object.keys(underlyings).forEach(a => {
      users.forEach(u => {
        calls4.push(new Contract(a, borrowableAbi).balanceOf(u))
      })
    })

    const dataFromCall4 = await tryWithTimeout(chain, calls4, blockNumber, undefined, '0xcA11bde05977b3631167028862bE2a173976CA11')

    const idleBalances = dataFromCall4.slice(conf.borrowables.length * 4)

    for (let i = 0; i <= Object.keys(underlyings).length; i++) {
      if (i !== 0 && !conf.assets[Object.keys(underlyings)[i - 1]]) {
        throw new Error(`${chain} unknown underlying ${Object.keys(underlyings)[i - 1]}`)
      }
      const asset = i === 0 ? (chain === Chains.FTM ? ASSETS.FTM : ASSETS.ETH) : conf.assets[Object.keys(underlyings)[i - 1]]
      const div = asset === ASSETS.USDC ? 10 ** 6 : 10 ** 18
      let j = 0
      for (const user of users) {
        const bn = idleBalances[i * users.length + j]
        if (idleBalancesByAsset[asset]) {
          idleBalancesByAsset[asset].bn += bn
        } else {
          idleBalancesByAsset[asset] = { bn, amount: 0, usd: 0 }
        }
        idleBalancesByAsset[asset].amount = Number((Number(idleBalancesByAsset[asset].bn) / div).toFixed(4))
        idleBalancesByAsset[asset].usd = Number((Number(idleBalancesByAsset[asset].bn) / div * getAssetPrice(asset)).toFixed(2))
        if (idleBalancesByChain[chain][asset]) {
          idleBalancesByChain[chain][asset].bn += bn
        } else {
          idleBalancesByChain[chain][asset] = { bn, amount: 0, usd: 0 }
        }

        if (bn > 0n) {
          const userIdleBalance = {
            bn,
            amount: Number((Number(bn) / div).toFixed(4)),
            usd: Number((Number(bn) / div * getAssetPrice(asset)).toFixed(2))
          }
          if (idleBalancesByChainByAssetByUser[chain][asset]) {
            if (idleBalancesByChainByAssetByUser[chain][asset][user]) {
              idleBalancesByChainByAssetByUser[chain][asset][user].bn += bn
              idleBalancesByChainByAssetByUser[chain][asset][user].amount = Number((Number(idleBalancesByChainByAssetByUser[chain][asset][user].bn) / div).toFixed(4))
              idleBalancesByChainByAssetByUser[chain][asset][user].usd = Number((Number(idleBalancesByChainByAssetByUser[chain][asset][user].bn) / div * getAssetPrice(asset)).toFixed(2))
            } else {
              idleBalancesByChainByAssetByUser[chain][asset][user] = {...userIdleBalance}
            }
          } else {
            idleBalancesByChainByAssetByUser[chain][asset] = {
              [user]: { ...userIdleBalance }
            }
          }
          if (idleBalancesByUser[user]) {
            idleBalancesByUser[user] = Number((idleBalancesByUser[user] + userIdleBalance.usd).toFixed(2))
          } else {
            idleBalancesByUser[user] = userIdleBalance.usd
          }
          if (idleBalancesByAssetByUser[asset]) {
            if (idleBalancesByAssetByUser[asset][user]) {
              idleBalancesByAssetByUser[asset][user].bn += bn
              idleBalancesByAssetByUser[asset][user].amount = Number((Number(idleBalancesByAssetByUser[asset][user].bn) / div).toFixed(4))
              idleBalancesByAssetByUser[asset][user].usd = Number((Number(idleBalancesByAssetByUser[asset][user].bn) / div * getAssetPrice(asset)).toFixed(2))
            } else {
              idleBalancesByAssetByUser[asset][user] = { ...userIdleBalance }
            }
          } else {
            idleBalancesByAssetByUser[asset] = { [user]: { ...userIdleBalance } }
          }
          if (idleBalancesByChainByUser[chain]) {
            if (idleBalancesByChainByUser[chain][user]) {
              idleBalancesByChainByUser[chain][user] = Number((idleBalancesByChainByUser[chain][user] + userIdleBalance.usd).toFixed(2))
            } else {
              idleBalancesByChainByUser[chain][user] = userIdleBalance.usd
            }
          } else {
            idleBalancesByChainByUser[chain] = { [user]: userIdleBalance.usd }
          }
        }

        idleBalancesByChain[chain][asset].amount = Number((Number(idleBalancesByChain[chain][asset].bn) / div).toFixed(4))
        idleBalancesByChain[chain][asset].usd = Number((Number(idleBalancesByChain[chain][asset].bn) / div * getAssetPrice(asset)).toFixed(2))
        j++
      }
    }

    let i = 0
    for (const b of conf.borrowables) {
      const [
        ,
        underlying,
        oldTotalBalance,
        oldTotalBorrows,
        oldExchangeRate,
        oldBorrowRate, // sync
        ,
        newBorrowRate,
        newTotalBalance,
        newTotalBorrows,
        newExchangeRate,
        reserveFactor,
        name,
        kinkUtilizationRate,
        ...deposits
      ] = borrowablesData.slice(i * callsPerBor, (i + 1) * callsPerBor)
      
      if (!conf.assets[underlying]) {
        throw new Error(`${chain} unknown underlying ${underlying} borrowable ${b}`)
      }

      const asset = conf.assets[underlying]
      const div = asset === ASSETS.USDC ? 10 ** 6 : 10 ** 18
      
      let balance: bigint = 0n
      
      for (let i = 0; i < users.length; i++) {
        const user = users[i]
        const _deposit = deposits[i] as bigint
        if (_deposit > 0n) {
          const bn = (_deposit * newExchangeRate) / ONE
          const deposit: Deposit = {
            bn,
            amount: Number((Number(bn) / div).toFixed(4)),
            usd: Number((Number(bn) / div * getAssetPrice(asset)).toFixed(2))
          }
          
          if (suppliedByUser[user]) {
            suppliedByUser[user] = Number((suppliedByUser[user] + deposit.usd).toFixed(2))
          } else {
            suppliedByUser[user] = deposit.usd
          }

          if (suppliedByChainByAssetByUser[chain]) {
            if (suppliedByChainByAssetByUser[chain][asset]) {
              if (suppliedByChainByAssetByUser[chain][asset][user]) {
                suppliedByChainByAssetByUser[chain][asset][user].bn += bn
                suppliedByChainByAssetByUser[chain][asset][user].amount = Number((Number(suppliedByChainByAssetByUser[chain][asset][user].bn) / div).toFixed(4))
                suppliedByChainByAssetByUser[chain][asset][user].usd = Number((Number(suppliedByChainByAssetByUser[chain][asset][user].bn) / div * getAssetPrice(asset)).toFixed(2))
              } else {
                suppliedByChainByAssetByUser[chain][asset][user] = { ...deposit }
              }
            } else {
              suppliedByChainByAssetByUser[chain][asset] = { [user]: { ...deposit } }
            }
          } else {
            suppliedByChainByAssetByUser[chain] = { [asset]: { [user]: { ...deposit } } }
          }

          if (suppliedByAssetByUser[asset]) {
            if (suppliedByAssetByUser[asset][user]) {
              suppliedByAssetByUser[asset][user].bn += bn
              suppliedByAssetByUser[asset][user].amount = Number((Number(suppliedByAssetByUser[asset][user].bn) / div).toFixed(4))
              suppliedByAssetByUser[asset][user].usd = Number((Number(suppliedByAssetByUser[asset][user].bn) / div * getAssetPrice(asset)).toFixed(2))
            } else {
              suppliedByAssetByUser[asset][user] = { ...deposit }
            }
          } else {
            suppliedByAssetByUser[asset] = { [user]: { ...deposit } }
          }

          if (suppliedByChainByUser[chain]) {
            if (suppliedByChainByUser[chain][user]) {
              suppliedByChainByUser[chain][user] = Number((suppliedByChainByUser[chain][user] + deposit.usd).toFixed(2))
            } else {
              suppliedByChainByUser[chain][user] = deposit.usd
            }
          } else {
            suppliedByChainByUser[chain] = { [user]: deposit.usd }
          }

          if (suppliedByChainByAssetByBorrowableByUser[chain]) {
            if (suppliedByChainByAssetByBorrowableByUser[chain][asset]) {
              if (suppliedByChainByAssetByBorrowableByUser[chain][asset][b]) {
                if (suppliedByChainByAssetByBorrowableByUser[chain][asset][b][user]) {
                  throw new Error(`already received borrowable ${b} balance for user ${user}`)
                } else {
                  suppliedByChainByAssetByBorrowableByUser[chain][asset][b][user] = { ...deposit }
                }
              } else {
                suppliedByChainByAssetByBorrowableByUser[chain][asset][b] = { [user]: { ...deposit } }
              }
            } else {
              suppliedByChainByAssetByBorrowableByUser[chain][asset] = { [b] : { [user]: { ...deposit } } }
            }
          } else {
            suppliedByChainByAssetByBorrowableByUser[chain] = { [asset]: { [b]: { [user]: { ...deposit } } } }
          }
        }
        
        balance += _deposit
      }

      const oldUserSupplied = Math.floor(Number((balance * oldExchangeRate) / ONE))
      const suppliedBN = (balance * newExchangeRate) / ONE
      const newUserSupplied = Number(suppliedBN)

      const platform = name.substring(0, name.indexOf(' '))
      const newSupply = newTotalBorrows + newTotalBalance

      const oldDailyYield = oldBorrowRate * 24n * 3600n * oldTotalBorrows

      const oldSupply = oldTotalBorrows + oldTotalBalance

      const oldDailyApr = Number(((oldDailyYield / oldSupply) * (ONE - reserveFactor)) / ONE) / 1e18

      const oldDailyEarnings = Math.floor(oldUserSupplied * oldDailyApr)

      const newDailyYield = newBorrowRate * 3600n * 24n * newTotalBorrows

      const newDailyApr = Number(((newDailyYield / newSupply) * (ONE - reserveFactor)) / ONE) / 1e18
      const newDailyEarnings = Math.floor(newUserSupplied * newDailyApr)

      const utilization = (newTotalBorrows * ONE) / newSupply
      const availableToDeposit =
        kinkUtilizationRate >= utilization ? 0n : (newTotalBorrows * ONE) / kinkUtilizationRate - newSupply

      const oppositeSymbol = dataFromCall4[i * 4]

      const vaultExchangeRateAfterReinvest = dataFromCall4[i * 4 + 2]
      const vaultBalanceAfterReinvest = dataFromCall4[i * 4 + 3]


      const reinvestPeriod = blockTimestamp - pastVaultStateByBorrowable[b].timestamp

      const bigBalanceChange = vaultBalanceAfterReinvest > pastVaultStateByBorrowable[b].totalBalance
          ? (vaultBalanceAfterReinvest - pastVaultStateByBorrowable[b].totalBalance) * 100n / pastVaultStateByBorrowable[b].totalBalance > 8n
          : (pastVaultStateByBorrowable[b].totalBalance - vaultBalanceAfterReinvest) * 100n / vaultBalanceAfterReinvest > 8n
      const vaultAPR = bigBalanceChange ? 'unknown' : Number((Number(vaultExchangeRateAfterReinvest - pastVaultStateByBorrowable[b].exchangeRate) * 360000 * 24 * 365 / reinvestPeriod / Number(pastVaultStateByBorrowable[b].exchangeRate)).toFixed(2))

      pools.push({
        platform,
        borrowable: b,
        asset,
        suppliedBN,
        tvl: Number((Number(newSupply) / div).toFixed(4)),
        tvlUsd: Number((Number(newSupply) / div * getAssetPrice(asset)).toFixed(2)),
        supplied: Number((newUserSupplied / div).toFixed(4)),
        suppliedUsd: Number(((newUserSupplied * (getAssetPrice(asset))) / div).toFixed(2)),
        kink: Number(kinkUtilizationRate) / 1e16,
        utilization: Number((Number(utilization) / 1e16).toFixed(2)),
        aprOld: Number((oldDailyApr * 36500).toFixed(2)),
        aprNew: Number((newDailyApr * 36500).toFixed(2)),
        earningsOld: Number((oldDailyEarnings / div).toFixed(4)),
        earningsNew: Number((newDailyEarnings / div).toFixed(4)),
        earningsOldUsd: Number(((oldDailyEarnings * (getAssetPrice(asset))) / div).toFixed(2)),
        earningsNewUsd: Number(((newDailyEarnings * (getAssetPrice(asset))) / div).toFixed(2)),
        availableToDeposit: Number((Number(availableToDeposit) / div).toFixed(4)),
        availableToDepositUsd: Number(((Number(availableToDeposit) * (getAssetPrice(asset))) / div).toFixed(2)),
        oppositeSymbol,
        vaultAPR,
        vault: vaultByBor[b],
        stable: stableByBor[b],
        chain,
      })

      if (cumulativeValuesByChains[chain][asset]) {
        cumulativeValuesByChains[chain][asset].oldUserSupplied += oldUserSupplied
        cumulativeValuesByChains[chain][asset].newUserSupplied += newUserSupplied
        cumulativeValuesByChains[chain][asset].oldDailyEarnings += oldDailyEarnings
        cumulativeValuesByChains[chain][asset].newDailyEarnings += newDailyEarnings
        cumulativeValuesByChains[chain][asset].maxDailyEarnings +=
          newDailyEarnings > oldDailyEarnings ? newDailyEarnings : oldDailyEarnings
      } else {
        cumulativeValuesByChains[chain][asset] = {
          oldUserSupplied,
          newUserSupplied,
          oldDailyEarnings,
          oldDailyEarningsUsd: 0,
          newDailyEarnings,
          maxDailyEarnings: newDailyEarnings > oldDailyEarnings ? newDailyEarnings : oldDailyEarnings,
          maxDailyEarningsUsd: 0,
          currentAPR: 0,
          newUserSuppliedUsd: 0,
          maxAPR: 0,
        }
      }
      if (cumulativeValuesByAsset[asset]) {
        cumulativeValuesByAsset[asset].oldUserSupplied += oldUserSupplied
        cumulativeValuesByAsset[asset].newUserSupplied += newUserSupplied
        cumulativeValuesByAsset[asset].oldDailyEarnings += oldDailyEarnings
        cumulativeValuesByAsset[asset].newDailyEarnings += newDailyEarnings
        cumulativeValuesByAsset[asset].maxDailyEarnings +=
          newDailyEarnings > oldDailyEarnings ? newDailyEarnings : oldDailyEarnings
      } else {
        cumulativeValuesByAsset[asset] = {
          oldUserSupplied,
          newUserSupplied,
          oldDailyEarnings,
          newDailyEarnings,
          newUserSuppliedUsd: 0,
          oldDailyEarningsUsd: 0,
          maxDailyEarningsUsd: 0,
          currentAPR: 0,
          maxAPR: 0,
          maxDailyEarnings: newDailyEarnings > oldDailyEarnings ? newDailyEarnings : oldDailyEarnings,
        }
      }
      i++
    }
  }

  await Promise.all(chains.map(callChain))

  for (const c in Chains) {
    for (const a in ASSETS) {
      const div = a === ASSETS.USDC ? 10 ** 6 : 10 ** 18
      const aca = cumulativeValuesByChains[c][a]
      if (aca) {
        aca.currentAPR = aca.newUserSupplied === 0 ? 0 : Number((aca.oldDailyEarnings * 36500 / aca.newUserSupplied).toFixed(2))
        aca.maxAPR = aca.newUserSupplied === 0 ? 0 : Number((aca.maxDailyEarnings * 36500 / aca.newUserSupplied).toFixed(2))
        aca.oldDailyEarnings = Number((aca.oldDailyEarnings / div).toFixed(4))
        aca.newUserSupplied = Number((aca.newUserSupplied / div).toFixed(4))
        aca.maxDailyEarnings = Number((aca.maxDailyEarnings / div).toFixed(4))
        aca.oldDailyEarningsUsd = Number((aca.oldDailyEarnings * getAssetPrice(a as ASSETS)).toFixed(2))
        aca.maxDailyEarningsUsd = Number((aca.maxDailyEarnings * getAssetPrice(a as ASSETS)).toFixed(2))
        aca.newUserSuppliedUsd = Number((aca.newUserSupplied * getAssetPrice(a as ASSETS)).toFixed(2))
        chainAggregatedStats[c].newUserSuppliedUsd = Number((chainAggregatedStats[c].newUserSuppliedUsd + aca.newUserSuppliedUsd).toFixed(2))
        chainAggregatedStats[c].oldDailyEarningsUsd = Number((chainAggregatedStats[c].oldDailyEarningsUsd + aca.oldDailyEarningsUsd).toFixed(2))
        chainAggregatedStats[c].maxDailyEarningsUsd = Number((chainAggregatedStats[c].maxDailyEarningsUsd + aca.maxDailyEarningsUsd).toFixed(2))
        chainAggregatedStats[c].maxAPR = chainAggregatedStats[c].newUserSuppliedUsd === 0 ? 0 : Number((chainAggregatedStats[c].maxDailyEarningsUsd * 36500 / chainAggregatedStats[c].newUserSuppliedUsd).toFixed(2))
        chainAggregatedStats[c].currentAPR = chainAggregatedStats[c].newUserSuppliedUsd === 0 ? 0 : Number((chainAggregatedStats[c].oldDailyEarningsUsd * 36500 / chainAggregatedStats[c].newUserSuppliedUsd).toFixed(2))
        if (aca.newUserSuppliedUsd + idleBalancesByChain[c][a].usd === 0) {
          delete cumulativeValuesByChains[c][a]
        }
      }
    }
  }

  Object.entries(idleBalancesByChain).forEach(([chain, props]) => {
    chainAggregatedStats[chain].usd = Number(Object.values(props).reduce((acc, { usd }) => acc + usd, 0).toFixed(2))
  })

  const sortedChains = Object.keys(cumulativeValuesByChains).sort((a, b) => {
    return chainAggregatedStats[b].newUserSuppliedUsd - chainAggregatedStats[a].newUserSuppliedUsd
  })

  sortedChains.forEach((chain, i) => {
    const val = cumulativeValuesByChains[chain]
    const sortedAssets = Object.keys(val).sort((assetA, assetB) => {
      return (val[assetB].newUserSuppliedUsd + (idleBalancesByChain[chain][assetB] ? idleBalancesByChain[chain][assetB].usd : 0))
          - (val[assetA].newUserSuppliedUsd + (idleBalancesByChain[chain][assetA] ? idleBalancesByChain[chain][assetA].usd : 0))
    })
    sortedAssets.forEach((x, j) => {
      if (j === 0) return
      const val2 = val[x]
      delete val[x]
      val[x] = val2
    })
    if (i === 0) return
    delete cumulativeValuesByChains[chain]
    cumulativeValuesByChains[chain] = val
  })

  let totalDeposited = 0
  let oldTotalEarnings = 0
  let newTotalEarnings = 0
  let maxTotalEarnings = 0
  for (const a in ASSETS) {
    const price = getAssetPrice(a as ASSETS)
    const div = a === ASSETS.USDC ? 10 ** 6 : 10 ** 18
    const ca = cumulativeValuesByAsset[a]
    if (cumulativeValuesByAsset[a]) {
      const [depUsd, oldEarnings, newEarinings, maxEarnings] = formatStats(ca, price, div)
      totalDeposited += Number(depUsd)
      oldTotalEarnings += Number(oldEarnings)
      newTotalEarnings += Number(newEarinings)
      maxTotalEarnings += Number(maxEarnings)
      ca.currentAPR = ca.newUserSupplied === 0 ? 0 : Number((ca.oldDailyEarnings * 36500 / ca.newUserSupplied).toFixed(2))
      ca.maxAPR = ca.newUserSupplied === 0 ? 0 : Number((ca.maxDailyEarnings * 36500 / ca.newUserSupplied).toFixed(2))
      ca.oldDailyEarnings = Number((ca.oldDailyEarnings / div).toFixed(4))
      ca.newUserSupplied = Number((ca.newUserSupplied / div).toFixed(4))
      ca.maxDailyEarnings = Number((ca.maxDailyEarnings / div).toFixed(4))
      ca.oldDailyEarningsUsd = Number((ca.oldDailyEarnings * getAssetPrice(a as ASSETS)).toFixed(2))
      ca.maxDailyEarningsUsd = Number((ca.maxDailyEarnings * getAssetPrice(a as ASSETS)).toFixed(2))
      ca.newUserSuppliedUsd = Number((ca.newUserSupplied * getAssetPrice(a as ASSETS)).toFixed(2))
      if (cumulativeValuesByAsset[a].newUserSuppliedUsd + idleBalancesByAsset[a].usd < 1) {
        delete cumulativeValuesByAsset[a]
      }
    }
  }

  const sortedAssets = Object.keys(cumulativeValuesByAsset).sort((a, b) => {
    return cumulativeValuesByAsset[b].newUserSuppliedUsd - cumulativeValuesByAsset[a].newUserSuppliedUsd
  })

  sortedAssets.forEach((x, i) => {
    if (i === 0) return
    const val = cumulativeValuesByAsset[x]
    delete cumulativeValuesByAsset[x]
    cumulativeValuesByAsset[x] = val
  })

  sortByUserSimple(idleBalancesByUser)
  sortByUserSimple(suppliedByUser)

  function sortByUserDeposit(byUser: { [user: string]: Deposit }) {
    const sortedUsers = Object.keys(byUser).sort((a, b) => {
      return byUser[b].usd === byUser[a].usd ? byUser[b].amount - byUser[a].amount : byUser[b].usd - byUser[a].usd
    })
    sortedUsers.forEach((x, i) => {
      if (i === 0) return
      const val = byUser[x]
      delete byUser[x]
      byUser[x] = val
    })
  }

  function sortByUserSimple(byUser: { [user: string]: number }) {
    const sortedUsers = Object.keys(byUser).sort((a, b) => {
      return byUser[b] - byUser[a]
    })
    sortedUsers.forEach((x, i) => {
      if (i === 0) return
      const val = byUser[x]
      delete byUser[x]
      byUser[x] = val
    })
  }

  ;[idleBalancesByAssetByUser, suppliedByAssetByUser].forEach((userMap) => {
    Object.entries(userMap).forEach(([_, byUser]) => {
      sortByUserDeposit(byUser)
    })
  })

  ;[idleBalancesByChainByAssetByUser, suppliedByChainByAssetByUser].forEach((userMap) => {
    Object.values(userMap).forEach((idleByAssetByUser) => {
      Object.values(idleByAssetByUser).forEach(sortByUserDeposit)
    })
  })

  ;[idleBalancesByChainByUser, suppliedByChainByUser].forEach((userMap) => {
    Object.values(userMap).forEach(sortByUserSimple)
  })

  Object.values(suppliedByChainByAssetByBorrowableByUser).forEach((chau) => {
    Object.values(chau).forEach((au) => {
      Object.values(au).forEach(sortByUserDeposit)
    })
  })

  const maxAPR = ((maxTotalEarnings * 36500) / totalDeposited).toFixed(2)

  const poolChains: { [chain: string]: true } = {}
  const poolAssets: { [chain: string]: true } = {}

  const goodPools = pools.filter(
      (x) => {
        const good = x.suppliedUsd > 1 ||
        (
            (x.aprNew > 8 && x.availableToDepositUsd > 1000) ||
            (x.aprNew > 15 && x.tvlUsd > 100_000)
        )
        if (good) {
          poolChains[x.chain] = true
          poolAssets[x.asset] = true
        }
        return good
      }
  ).sort((a, b) => b.aprNew - a.aprNew)

  const currentAPR = ((oldTotalEarnings * 36500) / totalDeposited).toFixed(2)

  const usd = Object.values(idleBalancesByAsset).reduce((acc, curr) => {
    return acc + curr.usd
  }, 0)

  const res = {
    goodPools,
    idleBalancesByAsset,
    idleBalancesByChain,
    idleBalancesByChainByUser,
    idleBalancesByChainByAssetByUser,
    idleBalancesByAssetByUser,
    idleBalancesByUser,
    cumulativeValuesByChains,
    cumulativeValuesByAsset,
    suppliedByUser,
    suppliedByAssetByUser,
    suppliedByChainByUser,
    suppliedByChainByAssetByUser,
    suppliedByChainByAssetByBorrowableByUser,
    totalDeposited: totalDeposited.toFixed(2),
    oldTotalEarnings: oldTotalEarnings.toFixed(2),
    newTotalEarnings: newTotalEarnings.toFixed(2),
    maxTotalEarnings: maxTotalEarnings.toFixed(2),
    maxAPR,
    currentAPR,
    chainAggregatedStats,
    poolAssets: Object.keys(poolAssets),
    poolChains: Object.keys(poolChains),
    usd: usd.toFixed(2),
    users,
  }

  ;(BigInt.prototype as any).toJSON = function () {
    return this.toString();
  }

  // console.log(JSON.stringify(res).toString())

  return res
}

function formatStats(stats: AssetStats, price: number, div: number) {
  return [
    ((stats.newUserSupplied / div) * price).toFixed(2),
    ((stats.oldDailyEarnings / div) * price).toFixed(2),
    ((stats.newDailyEarnings / div) * price).toFixed(2),
    ((stats.maxDailyEarnings / div) * price).toFixed(2),
  ]
}
