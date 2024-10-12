import {Call, Contract} from 'ethcall'

import borrowableAbi from '../../abi/borrowable.json' assert {type: 'json'}
import vaultAbi from '../../abi/vault.json' assert {type: 'json'}
import collateralAbi from '../../abi/collateral.json' assert {type: 'json'}
import {ASSETS, CHAIN_CONF, Chains, getAssetPrice} from '../constants/constants'
import {callWithTimeout, getCurrentEthCallProvider, web3EthCall} from '../provider/provider'
import ONE from '../utils/ONE'

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

type IdleBalance = {
  idle: number
  idleBN: number
  idleUsd: number
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
  vaultAPR: number
  chain: Chains
  asset: ASSETS
  oppositeSymbol: string
  vault: string
  stable: boolean
}

export default async function load(users: string[]) {
  const cumulativeValuesByChains: { [chain: string]: { [asset: string]: AssetStats } } = {}
  const cumulativeValuesByAsset: { [asset: string]: AssetStats } = {}
  const idleBalancesByAsset: { [asset: string]: IdleBalance } = {}
  const idleBalancesByChain: { [chain: string]: { [asset: string]:  IdleBalance } } = {}

  const pools: Pool[] = []

  const chains = Object.keys(CHAIN_CONF) as Chains[]

  async function callChain(chain: Chains) {
    cumulativeValuesByChains[chain] = {}
    idleBalancesByChain[chain] = {}
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
        vaultByBor[conf.borrowables[bIndex]] = bu
      } else if (conf.borrowables[bIndex] !== bu) {
        // console.log(`${chain} borrowable ${bu} collateral ${collaterals[bIndex]}`)
        const borrowable2 = new Contract(bu, borrowableAbi)
        calls3.push(borrowable2.underlying())
        calls3.push(borrowable2.getBlockTimestamp())
      }
    })
    const oppositeUnderlyingsAndStableFlags = await callWithTimeout(chain, calls3, pastBlockNumber, undefined, '0xcA11bde05977b3631167028862bE2a173976CA11')

    const pastVaultStateByBorrowable: { [b: string]: { timestamp: number, exchangeRate: bigint } } = {}

    const calls4: Call[] = []
    oppositeUnderlyingsAndStableFlags.forEach((val, i) => {
      switch (i % 5) {
        case 0:
          calls4.push(new Contract(val, borrowableAbi).symbol())
          const vault = new Contract(vaultByBor[conf.borrowables[Math.floor(i / 5)]], vaultAbi)
          calls4.push(vault.reinvest())
          calls4.push(vault.exchangeRate())
          break
        case 1:
          pastVaultStateByBorrowable[conf.borrowables[Math.floor(i / 5)]] = { timestamp: Number(val), exchangeRate: oppositeUnderlyingsAndStableFlags[i + 3] }
              break
        case 2:
          stableByBor[conf.borrowables[Math.floor(i / 5)]] = val
            break
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

    const dataFromCall4 = await callWithTimeout(chain, calls4, blockNumber, undefined, '0xcA11bde05977b3631167028862bE2a173976CA11')

    const idleBalances = dataFromCall4.slice(conf.borrowables.length * 3)

    for (let i = 0; i <= Object.keys(underlyings).length; i++) {
      const asset = i === 0 ? (chain === Chains.FTM ? ASSETS.FTM : ASSETS.ETH) : conf.assets[Object.keys(underlyings)[i - 1]]
      const div = asset === ASSETS.USDC ? 10 ** 6 : 10 ** 18
      let j = 0
      for (const _ of users) {
        if (idleBalancesByAsset[asset]) {
          idleBalancesByAsset[asset].idleBN += idleBalances[i * users.length + j]
        } else {
          idleBalancesByAsset[asset] = { idleBN: idleBalances[i * users.length + j], idle: 0, idleUsd: 0 }
        }
        idleBalancesByAsset[asset].idle = Number((Number(idleBalancesByAsset[asset].idleBN) / div).toFixed(4))
        idleBalancesByAsset[asset].idleUsd = Number((Number(idleBalancesByAsset[asset].idleBN) / div * await getAssetPrice(asset)).toFixed(2))
        if (idleBalancesByChain[chain][asset]) {
          idleBalancesByChain[chain][asset].idleBN += idleBalances[i * users.length + j]
        } else {
          idleBalancesByChain[chain][asset] = { idleBN: idleBalances[i * users.length + j], idle: 0, idleUsd: 0 }
        }
        idleBalancesByChain[chain][asset].idle = Number((Number(idleBalancesByChain[chain][asset].idleBN) / div).toFixed(4))
        idleBalancesByChain[chain][asset].idleUsd = Number((Number(idleBalancesByChain[chain][asset].idleBN) / div * await getAssetPrice(asset)).toFixed(2))
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
      const balance: bigint = deposits.reduce((acc, curr) => acc + curr, 0n)
      if (!conf.assets[underlying]) {
        throw new Error(`${chain} unknown underlying ${underlying} borrowable ${b}`)
      }

      const asset = conf.assets[underlying]

      const oldUserSupplied = Math.floor(Number((balance * oldExchangeRate) / ONE))
      const suppliedBN = (balance * newExchangeRate) / ONE
      const newUserSupplied = Number(suppliedBN)

      const platform = name.substring(0, name.indexOf(' '))

      const div = asset === ASSETS.USDC ? 10 ** 6 : 10 ** 18
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

      const oppositeSymbol = dataFromCall4[i * 3]

      const vaultExchangeRateAfterReinvest = dataFromCall4[i * 3 + 2]

      const reinvestPeriod = blockTimestamp - pastVaultStateByBorrowable[b].timestamp

      const vaultAPR = Number((Number(vaultExchangeRateAfterReinvest - pastVaultStateByBorrowable[b].exchangeRate) * 360000 * 24 * 365 / reinvestPeriod / Number(pastVaultStateByBorrowable[b].exchangeRate)).toFixed(2))

      pools.push({
        platform,
        borrowable: b,
        asset,
        suppliedBN,
        tvl: Number((Number(newSupply) / div).toFixed(4)),
        tvlUsd: Number((Number(newSupply) / div * await getAssetPrice(asset)).toFixed(2)),
        supplied: Number((newUserSupplied / div).toFixed(4)),
        suppliedUsd: Number(((newUserSupplied * (await getAssetPrice(asset))) / div).toFixed(2)),
        kink: Number(kinkUtilizationRate) / 1e16,
        utilization: Number((Number(utilization) / 1e16).toFixed(2)),
        aprOld: Number((oldDailyApr * 36500).toFixed(2)),
        aprNew: Number((newDailyApr * 36500).toFixed(2)),
        earningsOld: Number((oldDailyEarnings / div).toFixed(4)),
        earningsNew: Number((newDailyEarnings / div).toFixed(4)),
        earningsOldUsd: Number(((oldDailyEarnings * (await getAssetPrice(asset))) / div).toFixed(2)),
        earningsNewUsd: Number(((newDailyEarnings * (await getAssetPrice(asset))) / div).toFixed(2)),
        availableToDeposit: Number((Number(availableToDeposit) / div).toFixed(4)),
        availableToDepositUsd: Number(((Number(availableToDeposit) * (await getAssetPrice(asset))) / div).toFixed(2)),
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

  for (const a in ASSETS) {
    const div = a === ASSETS.USDC ? 10 ** 6 : 10 ** 18

    for (const c in Chains) {
      const aca = cumulativeValuesByChains[c][a]
      if (aca) {
        aca.currentAPR = Number((aca.oldDailyEarnings * 36500 / aca.newUserSupplied).toFixed(2))
        aca.maxAPR = Number((aca.maxDailyEarnings * 36500 / aca.newUserSupplied).toFixed(2))
        aca.oldDailyEarnings = Number((aca.oldDailyEarnings / div).toFixed(4))
        aca.newUserSupplied = Number((aca.newUserSupplied / div).toFixed(4))
        aca.maxDailyEarnings = Number((aca.maxDailyEarnings / div).toFixed(4))
        aca.oldDailyEarningsUsd = Number((aca.oldDailyEarnings * await getAssetPrice(a as ASSETS)).toFixed(2))
        aca.maxDailyEarningsUsd = Number((aca.maxDailyEarnings * await getAssetPrice(a as ASSETS)).toFixed(2))
        aca.newUserSuppliedUsd = Number((aca.newUserSupplied * await getAssetPrice(a as ASSETS)).toFixed(2))
        if (aca.newUserSuppliedUsd + idleBalancesByChain[c][a].idleUsd < 1) {
          delete cumulativeValuesByChains[c][a]
        }
      }
    }
  }

  let totalDeposited = 0
  let oldTotalEarnings = 0
  let newTotalEarnings = 0
  let maxTotalEarnings = 0
  for (const a in ASSETS) {
    const price = await getAssetPrice(a as ASSETS)
    const div = a === ASSETS.USDC ? 10 ** 6 : 10 ** 18
    const ca = cumulativeValuesByAsset[a]
    if (cumulativeValuesByAsset[a]) {
      const [depUsd, oldEarnings, newEarinings, maxEarnings] = formatStats(ca, price, div)
      totalDeposited += Number(depUsd)
      oldTotalEarnings += Number(oldEarnings)
      newTotalEarnings += Number(newEarinings)
      maxTotalEarnings += Number(maxEarnings)
      ca.currentAPR = Number((ca.oldDailyEarnings * 36500 / ca.newUserSupplied).toFixed(2))
      ca.maxAPR = Number((ca.maxDailyEarnings * 36500 / ca.newUserSupplied).toFixed(2))
      ca.oldDailyEarnings = Number((ca.oldDailyEarnings / div).toFixed(4))
      ca.newUserSupplied = Number((ca.newUserSupplied / div).toFixed(4))
      ca.maxDailyEarnings = Number((ca.maxDailyEarnings / div).toFixed(4))
      ca.oldDailyEarningsUsd = Number((ca.oldDailyEarnings * await getAssetPrice(a as ASSETS)).toFixed(2))
      ca.maxDailyEarningsUsd = Number((ca.maxDailyEarnings * await getAssetPrice(a as ASSETS)).toFixed(2))
      ca.newUserSuppliedUsd = Number((ca.newUserSupplied * await getAssetPrice(a as ASSETS)).toFixed(2))
      if (cumulativeValuesByAsset[a].newUserSuppliedUsd + idleBalancesByAsset[a].idleUsd < 1) {
        delete cumulativeValuesByAsset[a]
      }
    }
  }

  const maxAPR = ((maxTotalEarnings * 36500) / totalDeposited).toFixed(2)

  const goodPools = pools.filter(
      (x) =>
          x.suppliedUsd > 1 ||
          (
              (x.aprNew > 8 && x.availableToDepositUsd > 1000) ||
              (x.aprNew > 15 && x.tvlUsd > 100_000)
          )).sort((a, b) => b.aprNew - a.aprNew)

  const currentAPR = ((oldTotalEarnings * 36500) / totalDeposited).toFixed(2)

  const idleUsd = Object.values(idleBalancesByAsset).reduce((acc, curr) => {
    return acc + curr.idleUsd
  }, 0)

  const res = {
    goodPools,
    idleBalancesByAsset,
    idleBalancesByChain,
    cumulativeValuesByChains,
    cumulativeValuesByAsset,
    totalDeposited: totalDeposited.toFixed(2),
    oldTotalEarnings: oldTotalEarnings.toFixed(2),
    newTotalEarnings: newTotalEarnings.toFixed(2),
    maxTotalEarnings: maxTotalEarnings.toFixed(2),
    maxAPR,
    currentAPR,
    idleUsd: idleUsd.toFixed(2),
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
