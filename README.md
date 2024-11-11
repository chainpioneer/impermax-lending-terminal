# Impermax lending terminal

An advanced position management terminal for Impermax-like pools

Features: 
- Shows current and virtual (that can be applied onchain) APR of pools
- Allows users to `sync` interest rates. The button becomes active when your daily earnings delta of the pool reaches 1$.
- Shows combined data across multiple chains. SCROLL, OP, BASE, FTM and re.al (with USDC, ETH, wstETH, OP, FTM and IBEX pools) are supported.
- The app has no own backend and RPC requests are highly optimized. It's only 5 calls per chain to fetch all onchain data.
- Coingecko API is used to fetch assets prices.
- Current list of supported borrowables: [constants.ts](src/constants/constants.ts).
- Shows pools sorted by APR, but only those pools that either your address has a stake in or are highly-utilized with good APR.
- It's possible to show combined stats of multiple addresses. Just use coma separate addresses in the input field.
- Stores input addresses in localstorage.

Stack: Vue 3 + TypeScript + Vite