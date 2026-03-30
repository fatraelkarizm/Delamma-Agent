/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getScopeFromSearchParams } from "@/lib/runtimeScope";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const SOLANA_PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Derive public key from private key using Solana's public key derivation
// We use the Helius wallet info endpoint to avoid loading Solana SDK in Next.js
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const scope = getScopeFromSearchParams(searchParams);
    const walletKey = process.env.WALLET_PRIVATE_KEY;
    const rpcUrl    = process.env.HELIUS_RPC_URL || process.env.RPC_URL;
    const apiKey    = process.env.HELIUS_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "Missing HELIUS_API_KEY" }, { status: 500 });
    }

    // Call Helius enhanced API to get SOL price
    const priceRes = await fetch(
      `https://mainnet.helius-rpc.com/?api-key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "getAccountInfo",
          params: ["So11111111111111111111111111111111111111112", { encoding: "base64" }]
        }),
      }
    );

    // Get SOL price from Jupiter
    const solPriceRes = await fetch("https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112");
    const solPriceData = await solPriceRes.json();
    const solPrice = solPriceData?.data?.["So11111111111111111111111111111111111111112"]?.price ?? 0;

    // We can't derive wallet address server-side easily without full Solana SDK.
    // Read from env WALLET_ADDRESS if provided, otherwise derive from key prefix
    const walletAddress = scope.walletId || process.env.WALLET_ADDRESS || "Check .env for WALLET_ADDRESS";

    // Get wallet SOL balance from Helius
    let solBalance = 0;
    let solUsd = 0;

    if (walletAddress && walletAddress !== "Check .env for WALLET_ADDRESS" && SOLANA_PUBKEY_RE.test(walletAddress)) {
      const balRes = await fetch(
        `https://mainnet.helius-rpc.com/?api-key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0", id: 1, method: "getBalance",
            params: [walletAddress]
          }),
        }
      );
      const balData = await balRes.json();
      solBalance = (balData?.result?.value ?? 0) / 1e9;
      solUsd = Math.round(solBalance * solPrice * 100) / 100;
    }

    return NextResponse.json({
      wallet_address: walletAddress,
      sol_balance:    Math.round(solBalance * 10000) / 10000,
      sol_usd:        solUsd,
      sol_price:      Math.round(solPrice * 100) / 100,
      scoped:         Boolean(scope.walletId),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
