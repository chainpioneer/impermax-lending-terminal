import { Call, Provider } from 'ethcall'
import { JsonRpcProvider } from 'ethers'
import Web3 from 'web3'

import { CHAIN_CONF, Chains } from '../constants/constants'
import sleep from '../utils/sleep'

export const WEB3_PROVIDERS: { [key: string]: Web3[] } = {}
Object.entries(CHAIN_CONF).forEach(([chain, { rpcUrls }]) => {
  WEB3_PROVIDERS[chain] = rpcUrls.map((x) => new Web3(x))
})

export const ETH_CALL_PROVIDERS: { [key: string]: Provider[] } = {}

Object.entries(CHAIN_CONF).forEach(([chain, { rpcUrls, chainId }]) => {
  ETH_CALL_PROVIDERS[chain] = []
  rpcUrls.forEach((x) => {
    const ethersProvider = new JsonRpcProvider(x)
    ETH_CALL_PROVIDERS[chain].push(
      new Provider(chainId, ethersProvider, {
        multicall: { address: '0xcA11bde05977b3631167028862bE2a173976CA11', block: 0 },
      }),
    )
  })
})

const lastProviderIndex: { [key: string]: number } = {}
const maxErrCount: { [key: string]: number } = {}
Object.entries(CHAIN_CONF).forEach(([chain, { rpcUrls }]) => {
  lastProviderIndex[chain] = 0
  maxErrCount[chain] = rpcUrls.length * 2
})

export function getCurrentEthCallProvider(chain: Chains) {
  return ETH_CALL_PROVIDERS[chain][lastProviderIndex[chain]]
}

function switchProvider(chain: Chains) {
  const oldProviderIndex = lastProviderIndex[chain]
  const nextProviderIndex = oldProviderIndex + 1
  lastProviderIndex[chain] = nextProviderIndex === WEB3_PROVIDERS[chain].length ? 0 : nextProviderIndex
  console.log(`${chain} switching provider ${oldProviderIndex} -> ${lastProviderIndex[chain]}`)
}

export async function callWithTimeout(
  chain: Chains,
  requests: Call[],
  blockNumber?: number,
  timeout = 15_000,
  from = `0x${'0'.repeat(40)}`,
): Promise<any[]> {
  let errCount = 0
  let result
  while (!result) {
    try {
      result = await Promise.race([
        ETH_CALL_PROVIDERS[chain][lastProviderIndex[chain]].all(requests, {
          blockTag: blockNumber,
          from,
        }),
        sleep(timeout),
      ])
    } catch (e) {
      console.log(String(e))
      errCount++
      console.log('eth_call failed', errCount)
      if (errCount > maxErrCount[chain]) {
        console.log(requests)
        throw new Error(`eth_call failed ${maxErrCount} times`)
      }
    }
    if (!result) {
      switchProvider(chain)
      return callWithTimeout(chain, requests, blockNumber, timeout)
    }
    await sleep(1_000 * errCount)
  }
  return result as any[]
}

export async function web3EthCall(chain: Chains, method: string, params: any[], timeout?: number) {
  const providerCount = WEB3_PROVIDERS[chain].length
  for (let i = 0; i < providerCount * 2; i++) {
    const web3: Web3 = WEB3_PROVIDERS[chain][lastProviderIndex[chain]]

    try {
      const result = timeout
        ? await Promise.race([(web3.eth as any)[method](...params), sleep(timeout)])
        : await (web3.eth as any)[method](...params)
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      if (result === undefined) {
        // console.log({ method, params, timeout })
        if (timeout) throw new Error(`timeout ${timeout / 1000}s`)
        throw new Error(`empty provider response: ${result}`)
      }
      return result
    } catch (e) {
      console.log(e)
      console.log(`Web3 eth call failed ${method} index ${lastProviderIndex}`)
      console.log(params)
      switchProvider(chain)
    }
  }
  throw new Error(`Web3 eth call failed 2 times: method ${method} provider count ${providerCount}`)
}
