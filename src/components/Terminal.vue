<script setup lang="ts">
import {ref} from 'vue'
import load from "../logic/load";
import {isAddress} from "web3-validator";
import InputText from 'primevue/inputtext';
import Button from 'primevue/button';
import Card from 'primevue/card';
import InputNumber from 'primevue/inputnumber'
import Image from 'primevue/image';
import ProgressSpinner from 'primevue/progressspinner';
import {ASSETS, Chains} from "../constants/constants";

defineProps<{ msg: string }>()

const fetchingData = ref(false)
const subscribed = ref(false)
const addresses = ref(localStorage.getItem('userStr') || '')
const data: any = ref(undefined)
const wallet = ref('')
const chain = ref('')

const storage = () => localStorage

const chainIdByChain = {
  [Chains.SCROLL]: '0x82750',
  [Chains.OP]: '0xa',
  [Chains.FTM]: '0xfa',
  [Chains.BASE]: '0x2105',
}

const ethereum = () => (window as any).ethereum

function chainImgSrc(ch: number | string) {
  switch (ch) {
    case Chains.FTM:
      return 'https://cryptologos.cc/logos/fantom-ftm-logo.png'
    case Chains.BASE:
      return 'https://avatars.githubusercontent.com/u/108554348?v=4'
    case Chains.OP:
      return 'https://cryptologos.cc/logos/optimism-ethereum-op-logo.png'
    case Chains.SCROLL:
      return 'https://global.discourse-cdn.com/flex032/uploads/scroll2/original/2X/3/3bc70fd653f9c50abbb41b7568e549535f768fcc.png'
    default:
      return 'https://static.thenounproject.com/png/1166209-200.png'
  }
}

function assetImgSrc(asset: number | string) {
  switch (asset) {
    case ASSETS.FTM:
      return chainImgSrc(Chains.FTM)
    case 'fBOMB':
      return 'https://whattofarm.io/assets/dex/tokens/200/fbomb-bomb-logo.webp'
    case ASSETS.OP:
      return chainImgSrc(Chains.OP)
    case ASSETS.wstETH:
      return 'https://s2.coinmarketcap.com/static/img/coins/200x200/12409.png'
    case ASSETS.USDC:
      return 'https://cryptologos.cc/logos/usd-coin-usdc-logo.png'
    case ASSETS.ETH:
      return 'https://seeklogo.com/images/E/ethereum-logo-EC6CDBA45B-seeklogo.com.png'
    default:
      return 'https://static.thenounproject.com/png/1166209-200.png'
  }
}

function protocolImgSrc(platform: string) {
  if (platform === 'Impermax') {
    return 'https://icons.llama.fi/impermax-finance.png'
  } else if (platform === 'Tarot') {
    return 'https://assets.coingecko.com/coins/images/31800/large/TAROT.jpg'
  }
  return 'https://static.thenounproject.com/png/1166209-200.png'
}

function linkToPool(pool: { vault: string, platform: string, chain: Chains, stable: boolean}) {
  if (pool.platform === 'Tarot') {
    let chainId
    switch (pool.chain) {
      case Chains.BASE: chainId = '8453'; break
      case Chains.SCROLL: chainId = '534352'; break
      case Chains.OP: chainId = '10'; break
      case Chains.FTM: chainId = '250'; break
      default: throw new Error(`unknown chain ${pool.chain}`)
    }
    return `https://tarot.to/lending-pool/${chainId}/${pool.vault.toLowerCase()}`
  }
  let chainPrefix
  switch (pool.chain) {
    case Chains.BASE: chainPrefix = 'base'; break
    case Chains.SCROLL: chainPrefix = 'scroll'; break
    case Chains.OP: chainPrefix = 'optimism'; break
    case Chains.FTM: chainPrefix = 'fantom'; break
    default: throw new Error(`unknown chain ${pool.chain}`)
  }
  return `https://${chainPrefix}.impermax.finance/lending-pool/${pool.stable ? '7' : '6'}/${pool.vault.toLowerCase()}`
}

function extractAddresses(str: string): string[] {
  return str.split(",").map(s => s.replace(" ", ''))
}

function invalidAddresses(str: string) {
  const addresses = extractAddresses(str)

  const addr: { [a: string]: true } = {}
  return addresses.find(a => {
    if (addr[a]) return a
    addr[a] = true
    return !isAddress(a)
  }) !== undefined
}

function toUSDCurrency(n: number | string): string {
  n = String(n)
  const pointIndex = n.indexOf('.')

  let lastIndex
  let s
  if (pointIndex === -1) {
    s = ''
    lastIndex = n.length - 1
  } else {
    lastIndex = pointIndex
    s = n.substring(pointIndex)
  }

  let i
  for (i = lastIndex - 3; i > 0; i -= 3) {
    s = `,${n.substring(i, i + 3)}${s}`
  }


  return `$${n.substring(0, i + 3)}${s}`
}

</script>

<template>
  <h1>{{ msg }}</h1>


  <Card>
    <template #content>
      <InputText v-model="addresses" placeholder="input addresses" size="large"/>
    </template>
    <template #footer>
      <div>
        <template v-if="fetchingData">
          <ProgressSpinner style="width: 50px; height: 50px" strokeWidth="8" fill="transparent"
                           animationDuration=".5s" aria-label="Custom ProgressSpinner" />
        </template>
        <template v-else>
          <Button label="fetch data" class="w-full" :disabled='invalidAddresses(addresses) || fetchingData' @click="( async() => {
            fetchingData = true
            storage().setItem('userStr', addresses)
            data = await load(extractAddresses(addresses))
            fetchingData = false
          } )"></Button>
        </template>
      </div>
    </template>
  </Card>

  <Card class="card-block">
    <template #title>Global stats</template>
    <template #content>
      <div class="global-stats">
        <template v-if="data">
          <Card class="card-chain">
            <template #content>
                  <p class="m-0">
                    Total deposited: {{toUSDCurrency(data.totalDeposited)}}
                  </p>
                  <p class="m-0">
                    Daily earnings: {{ toUSDCurrency(data.oldTotalEarnings) }} -> {{ toUSDCurrency(data.maxTotalEarnings) }}
                  </p>
                  <p class="m-0">
                    APR: {{data.currentAPR}}% -> {{data.maxAPR}}%
                  </p>
                  <div class="card flex flex-wrap gap-4">
                    <div class="flex-auto">
                        <label for="idle-total" class="font-bold block mb-2"> Idle </label>
                        <InputNumber v-model="data.idleUsd" disabled="true" inputId="idle-total" mode="currency" currency="USD" locale="en-US" />
                    </div>
                  </div>
            </template>
          </Card>
        </template>
      </div>
    </template>
  </Card>

  <Card class="card-block">
    <template #title>Liquidity by assets</template>
    <template #content>
      <div class="asset-summarized-info">
        <template v-if="data" v-for="(assetProps, asset) in data.cumulativeValuesByAsset">
          <Card class="card-chain">
            <template #title>
              <Image :src='assetImgSrc(asset)' :alt='asset' width="50px" />
            </template>
            <template #content>
              <p class="m-0">
                Supplied: {{assetProps.newUserSupplied}} ({{toUSDCurrency(assetProps.newUserSuppliedUsd)}})
              </p>
              <p class="m-0">
                Daily earnings: {{ assetProps.oldDailyEarnings }} ({{toUSDCurrency(assetProps.oldDailyEarningsUsd)}}) -> {{ assetProps.maxDailyEarnings }} ({{toUSDCurrency(assetProps.maxDailyEarningsUsd)}})
              </p>
              <p class="m-0">
                APR: {{assetProps.currentAPR}}% -> {{assetProps.maxAPR}}%
              </p>
              <p class="m-0">
                Idle: {{data.idleBalancesByAsset[asset].idle}} ({{toUSDCurrency(data.idleBalancesByAsset[asset].idleUsd)}})
              </p>
            </template>
          </Card>
        </template>
      </div>
    </template>
  </Card>

  <Card class="card-block">
    <template #title>Liquidity by chains</template>
    <template #content>
      <div class="chain-summarized-info">
        <template v-if="data" v-for="(chainProps, chain) in data.cumulativeValuesByChains">
          <Card class="card-chain">
            <template #title>

              <Image :src='chainImgSrc(chain)' :alt='chain' width="50px" />
            </template>
            <template #content>
              <template v-for="(assetProps, asset) in chainProps">
                <Card class="card-asset">
                  <template #title>
                    <Image :src='assetImgSrc(asset)' :alt='asset' width="30px" />
                  </template>
                  <template #content>
                    <p class="m-0">
                      Supplied: {{assetProps.newUserSupplied}} ({{toUSDCurrency(assetProps.newUserSuppliedUsd)}})
                    </p>
                    <p class="m-0">
                      Daily earnings: {{ assetProps.oldDailyEarnings }} ({{toUSDCurrency(assetProps.oldDailyEarningsUsd)}}) -> {{ assetProps.maxDailyEarnings }} ({{toUSDCurrency(assetProps.maxDailyEarningsUsd)}})
                    </p>
                    <p class="m-0">
                      APR: {{assetProps.currentAPR}}% -> {{assetProps.maxAPR}}%
                    </p>
                    <p class="m-0">
                      Idle: {{data.idleBalancesByChain[chain][asset].idle}} ({{toUSDCurrency(data.idleBalancesByChain[chain][asset].idleUsd)}})
                    </p>
                  </template>
                </Card>
              </template>
            </template>
          </Card>
        </template>
      </div>
    </template>
  </Card>

  <Card class="card-block">
    <template #title>Pools</template>
    <template #content>
      <div class="asset-summarized-info">
        <template v-if="data" v-for="pool in data.goodPools">
          <Card class="card-chain">
            <template #title>Collateral: {{pool.asset}}/{{pool.oppositeSymbol}} ({{pool.vaultAPR}}%)</template>
            <template #subtitle>{{pool.borrowable}}</template>
            <template #content>
              <p class="m-0">
                Supplied: {{pool.supplied}} ({{toUSDCurrency(pool.suppliedUsd)}})
              </p>
              <p class="m-0">
                Daily earnings: {{ pool.earningsOld }} ({{toUSDCurrency(pool.earningsOldUsd)}}) -> {{ pool.earningsNew }} ({{toUSDCurrency(pool.earningsNewUsd)}})
              </p>
              <p class="m-0">
                APR: {{pool.aprOld}}% -> {{pool.aprNew}}%
              </p>
              <p class="m-0">
                Utilization: {{pool.utilization}}% / {{pool.kink}}%
              </p>
              <p class="m-0">
                Capacity: {{pool.availableToDeposit}} ({{toUSDCurrency(pool.availableToDepositUsd)}})
              </p>
              <p class="m-0">
                TVL: {{pool.tvl}} ({{toUSDCurrency(pool.tvlUsd)}})
              </p>
            </template>
            <template #footer>
                <div style="display: flex; justify-content: center; align-items: center;">
                    <Button as="a" label="Go to pool" severity="secondary" outlined class="w-full" :href='linkToPool(pool)' target="_blank" rel="noopener" />
                    <Button v-if='ethereum() && pool.earningsNewUsd - pool.earningsOldUsd >= 1' @click='(async () => {
                      if (ethereum()) {
                        if (!subscribed) {
                          ethereum().on("accountsChanged", async () => {
                              const [addr] = await ethereum().enable()
                              wallet = addr
                              chain = ethereum().chainId
                              console.log(`account switched to ${addr}`)
                          })
                          ethereum().on("networkChanged", async () => {
                              const [addr] = await ethereum().enable()
                              wallet = addr
                              chain = ethereum().chainId
                              console.log(`chain switched to ${chain}`)
                          })
                          console.log(`subscribed to wallet events`)
                          subscribed = true
                        }
                        const [addr] = await ethereum().enable()
                        if (wallet !== addr) {
                          wallet = addr
                          console.log("wallet connected", wallet)
                          chain = ethereum().chainId
                        } else if (chainIdByChain[pool.chain as Chains] !== chain) {
                          await ethereum().request({
                           "method": "wallet_switchEthereumChain",
                           "params": [
                            {
                              chainId: chainIdByChain[pool.chain as Chains]
                            }
                          ],
                          })
                          chain = ethereum().chainId
                        } else {
                          ethereum().request({
                            "method": "eth_sendTransaction",
                            "params": [
                              {
                                  from: wallet,
                                  to: pool.borrowable,
                                  data: "0xfff6cae9",
                                  value: `0x`,
                                  chainId: chainIdByChain[pool.chain as Chains],
                              }
                            ]
                          });
                        }
                        }
                    })' :label='ethereum() ? wallet ? chain === chainIdByChain[pool.chain as Chains] ? "sync" : `switch n to ${pool.chain}` : "connect wallet" : "no wallet detected"' class="w-full" />
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between">
                  <div>
                  <Image :src='chainImgSrc(pool.chain)' :alt='pool.chain' width="25px"/>
                  <Image :src='protocolImgSrc(pool.platform)' :alt='pool.platform' width="25px"/>
                  </div>
                  <Image :src='assetImgSrc(pool.asset)' :alt='pool.asset' width="25px"/>
                </div>
            </template>
          </Card>
        </template>
      </div>
    </template>
  </Card>
</template>

<style scoped>

.chain-summarized-info {
  margin: 1rem;
  display: flex;
  flex-wrap: wrap;
}

.card-block {
  margin: 1rem;
  display: flex;
  flex-wrap: wrap;
}

.asset-summarized-info {
  margin: 1rem;
  display: flex;
  flex-wrap: wrap;
}

.card-chain {
  flex: 0 1 max(32%, 300px);
  margin: 5px;
}

.card-asset {
  flex: 0 1 max(32%, 300px);
  margin: 5px;
}

</style>
