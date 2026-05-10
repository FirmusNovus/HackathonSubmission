import type { Page } from "@playwright/test";
import { mnemonicToAccount } from "viem/accounts";

const ANVIL_MNEMONIC =
  process.env.ANVIL_MNEMONIC ?? "basket salmon giraffe unit wine chat pretty behind aim habit cattle donor";

/**
 * Inject a minimal EIP-1193 provider at `window.ethereum` backed by the given
 * anvil mnemonic account index. wagmi's `injected()` connector will pick it up.
 *
 * Account 0 is the operator (used by Deploy.s.sol) — pick anything ≥ 1 for tests.
 *
 * Signing happens server-side via `page.exposeFunction` so the browser doesn't
 * need viem (avoids bundling). The shim's `personal_sign` handler decodes the
 * hex payload to UTF-8 and bounces it to the exposed function for signing.
 */
export async function installAnvilWallet(page: Page, accountIndex: number = 1) {
  const account = mnemonicToAccount(ANVIL_MNEMONIC, { accountIndex });

  await page.exposeFunction("__anvilWalletSignMessage", async (message: string) => {
    return await account.signMessage({ message });
  });

  await page.addInitScript(
    ({ address, chainIdHex }) => {
      const handlers = new Map<string, Array<(data: unknown) => void>>();
      const provider = {
        isAnvilTestWallet: true,
        isConnected: () => true,
        request: async ({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> => {
          if (method === "eth_chainId") return chainIdHex;
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [address];
          if (method === "personal_sign") {
            const messageHex = (params as [string])[0];
            const hexStr = messageHex.startsWith("0x") ? messageHex.slice(2) : messageHex;
            const bytes = new Uint8Array(hexStr.length / 2);
            for (let i = 0; i < hexStr.length; i += 2) {
              bytes[i / 2] = parseInt(hexStr.substring(i, i + 2), 16);
            }
            const message = new TextDecoder().decode(bytes);
            return await (window as unknown as { __anvilWalletSignMessage: (m: string) => Promise<string> })
              .__anvilWalletSignMessage(message);
          }
          if (method === "wallet_switchEthereumChain") return null;
          if (method === "wallet_addEthereumChain") return null;
          throw new Error(`anvil shim: unsupported RPC method ${method}`);
        },
        on: (event: string, cb: (data: unknown) => void) => {
          const arr = handlers.get(event) ?? [];
          arr.push(cb);
          handlers.set(event, arr);
        },
        removeListener: (event: string, cb: (data: unknown) => void) => {
          const arr = handlers.get(event);
          if (arr) handlers.set(event, arr.filter((h) => h !== cb));
        },
        removeAllListeners: () => handlers.clear(),
      };
      (window as unknown as { ethereum: typeof provider }).ethereum = provider;
    },
    { address: account.address.toLowerCase(), chainIdHex: "0x7a69" },
  );

  return { address: account.address };
}
