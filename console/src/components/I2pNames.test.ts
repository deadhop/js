import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import Network from "./Network.svelte";
import { ApiError, type ConsoleApi } from '../lib/api';
import { i2pRule } from "@deadhop/network-ui/lib/proxy";
import type { ProxyEntry, NetworkSettings as SettingsT } from "../lib/schemas";
import {
  B32,
  REGISTRIES,
  health,
  i2pLookup,
  proxyCheck,
  relayHistory,
  settings,
  networkView,
} from "../test-helpers";

const ROUTER: ProxyEntry = {
  id: "r",
  name: "i2pd",
  url: "http://127.0.0.1:4444",
  keys: [],
  pool: false,
  i2p: true,
};
const TOR: ProxyEntry = {
  id: "t",
  name: "tor",
  url: "socks5://127.0.0.1:9050",
  keys: [],
  pool: true,
};
const NAMED = `ws://${B32}`;
const OTHER = "q2fmh7ypkbu3hz2hv6dlz6c3zmnh5vlofb2w7ytsv3qvxmtx4xqa.b32.i2p";

async function setup(
  over: Partial<SettingsT> = {},
  view: "relays" | "proxies" = "relays",
  lookup = vi.fn().mockResolvedValue(i2pLookup()),
  answer = true,
) {
  const s = settings({
    ...over,
    proxies: { ...settings().proxies, list: [TOR, ROUTER], ...over.proxies },
  });
  const v = networkView({ settings: s });
  const api = {
    getNetwork: vi.fn().mockResolvedValue(v),
    updateNetwork: vi.fn().mockResolvedValue(v),
    checkProxy: vi.fn().mockResolvedValue(proxyCheck()),
    getRelayHistory: vi.fn().mockResolvedValue(relayHistory({ relays: [] })),
    getHealth: vi.fn().mockResolvedValue(health()),
    resolveI2pName: lookup,
  };
  const confirm = vi.fn().mockReturnValue(answer);
  render(Network, {
    props: {
      api: api as unknown as ConsoleApi,
      pageRelays: ["ws://127.0.0.1:7777"],
      confirm,
      networkView: view,
    },
  });
  await screen.findByRole("button", { name: "Save changes" });
  return { ...api, confirm };
}

const nameOf = (relay: string) =>
  (screen.getByLabelText(`Name of ${relay}`) as HTMLInputElement).value;
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
const type = (label: string, value: string) =>
  fireEvent.input(screen.getByLabelText(label), { target: { value } });
const patchOf = (t: Awaited<ReturnType<typeof setup>>) =>
  t.updateNetwork.mock.calls.at(-1)![0];

describe("the I2P router proxy", () => {
  it("is a type of its own, on port 4444, outside the default route, and only one", async () => {
    const t = await setup(
      { proxies: { ...settings().proxies, list: [TOR] } },
      "proxies",
    );
    await click("Create proxy");
    const kind = screen.getByLabelText("Type") as HTMLSelectElement;
    expect(
      (kind.querySelector('option[value="i2p"]') as HTMLOptionElement).disabled,
    ).toBe(false);
    await fireEvent.change(kind, { target: { value: "i2p" } });
    expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe(
      "4444",
    );
    expect(screen.getByText(/usually port 4444/)).toBeTruthy();
    // A port typed by hand stays when the type changes.
    await type("Port", "4445");
    await fireEvent.change(kind, { target: { value: "http" } });
    await fireEvent.change(kind, { target: { value: "i2p" } });
    expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe(
      "4445",
    );
    await type("Port", "");
    await fireEvent.change(kind, { target: { value: "i2p" } });
    expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe(
      "4444",
    );
    await click("Add to list");
    expect(screen.getByText("I2P router")).toBeTruthy();
    expect(
      screen.getByText(
        "Save this proxy first. Then it can carry your .i2p relays.",
      ),
    ).toBeTruthy();
    // A second one cannot be made.
    await click("Create proxy");
    expect(
      (document.querySelector('option[value="i2p"]') as HTMLOptionElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.getByText("An I2P router is already listed. Only one can be."),
    ).toBeTruthy();
    await click("Cancel");
    await fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(t.updateNetwork).toHaveBeenCalled());
    expect(patchOf(t).proxies.list[1]).toEqual({
      name: "",
      url: "http://127.0.0.1:4444",
      keys: [],
      pool: false,
      i2p: true,
    });
  });

  it("edits as an I2P router, and can stop being one", async () => {
    const t = await setup({}, "proxies");
    await screen.findByText("I2P router");
    await click("Edit proxy 2");
    expect((screen.getByLabelText("Type") as HTMLSelectElement).value).toBe(
      "i2p",
    );
    expect(
      (document.querySelector('option[value="i2p"]') as HTMLOptionElement)
        .disabled,
    ).toBe(false);
    await fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "http" },
    });
    await click("Update proxy");
    expect(screen.queryByText("I2P router")).toBeNull();
    // Without an I2P router there is nothing about names.
    expect(screen.queryByText("I2P names")).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(t.updateNetwork).toHaveBeenCalled());
    expect(patchOf(t).proxies.list[1]).toEqual({
      id: "r",
      name: "i2pd",
      url: "http://127.0.0.1:4444",
      keys: [],
      pool: false,
    });
  });

  it("keeps the registries below the proxies, only with an I2P router", async () => {
    await setup({}, "proxies");
    expect(
      await screen.findByText(/Where .i2p names are looked up is below/),
    ).toBeTruthy();
    expect(screen.getByLabelText("Add registry")).toBeTruthy();
    document.body.innerHTML = "";
    await setup({ proxies: { ...settings().proxies, list: [TOR] } }, "proxies");
    expect(screen.queryByText("I2P names")).toBeNull();
  });

  it("checks the registries like the service does", async () => {
    const t = await setup({}, "proxies");
    await screen.findByText("I2P names");
    expect(screen.getByText(/looked up once through i2pd/)).toBeTruthy();
    await type("Add registry", "http://example.com/?q={name}");
    await click("Add");
    expect(screen.getByRole("alert").textContent).toContain(
      "lowercase .i2p host",
    );
    await type("Add registry", " http://reg.i2p/?q={name} ");
    expect(screen.queryByRole("alert")).toBeNull();
    await click("Add");
    await type("Add registry", "http://four.i2p/{name}");
    await click("Add");
    expect(screen.getByText("Four registries is the most.")).toBeTruthy();
    await click("Remove registry notbob.i2p");
    await click("Remove registry stats.i2p");
    await click("Remove registry reg.i2p");
    await click("Remove registry four.i2p");
    expect(
      screen.getByText("No registries: names cannot be looked up."),
    ).toBeTruthy();
    await type("Add registry", "http://reg.i2p/?q={name}");
    await click("Add");
    await fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(t.updateNetwork).toHaveBeenCalled());
    expect(patchOf(t)).toEqual({
      proxies: { i2p_registries: ["http://reg.i2p/?q={name}"] },
    });
  });

  it("sends .i2p relays through it in one click, once", async () => {
    const t = await setup({}, "proxies");
    await click("Send .i2p relays through this proxy");
    expect(
      screen.getByText("Rule 1 decides where .i2p relays go: i2pd."),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: "Send .i2p relays through this proxy",
      }),
    ).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(t.updateNetwork).toHaveBeenCalled());
    expect(patchOf(t)).toEqual({ proxies: { rules: [i2pRule("r")] } });
  });
});

describe("relays by I2P name", () => {
  it("adds a .i2p name as an ordinary address while no I2P router is saved", async () => {
    const t = await setup({ proxies: { ...settings().proxies, list: [TOR] } });
    await type("Add relay", "ws://nostr-not.i2p");
    await click("Add");
    expect(screen.getByText("ws://nostr-not.i2p")).toBeTruthy();
    expect(t.resolveI2pName).not.toHaveBeenCalled();
  });

  it("looks a name up and adds the address found, keeping the name", async () => {
    let answer!: (l: unknown) => void;
    const t = await setup(
      {},
      "relays",
      vi.fn().mockReturnValue(new Promise((r) => (answer = r))),
    );
    await type("Add relay", "ws://nostr-not.i2p:7777/");
    await click("Look up");
    expect(screen.getByText(/This can take a minute/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Looking up…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    answer(i2pLookup());
    await screen.findByText(
      `nostr-not.i2p → ${B32} (from notbob.i2p; stats.i2p doesn't know it)`,
    );
    expect(t.resolveI2pName).toHaveBeenCalledWith("nostr-not.i2p");
    await click("Add as this address");
    expect(nameOf(`ws://${B32}:7777/`)).toBe("nostr-not.i2p");
    expect(screen.getByText(`ws://${B32}:7777/`)).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(t.updateNetwork).toHaveBeenCalled());
    expect(patchOf(t)).toEqual({
      relays: ["ws://127.0.0.1:7777", `ws://${B32}:7777/`],
      relay_names: { [`ws://${B32}:7777/`]: "nostr-not.i2p" },
    });
  });

  it("warns when registries disagree, lists the ones not reached, and can be cancelled or retyped", async () => {
    await setup(
      {},
      "relays",
      vi
        .fn()
        .mockResolvedValue(
          i2pLookup({
            disagreeing: [{ registry: REGISTRIES[1], address: OTHER }],
            unknown: [],
            unreachable: ["http://gone.i2p/{name}"],
          }),
        ),
    );
    await type("Add relay", "ws://nostr-not.i2p");
    await click("Look up");
    expect((await screen.findByRole("alert")).textContent).toContain(
      `Registries disagree: stats.i2p gives ${OTHER}`,
    );
    expect(screen.getByText("Not reached: gone.i2p.")).toBeTruthy();
    await click("Cancel");
    expect(screen.queryByText(/Registries disagree/)).toBeNull();
    await click("Look up");
    await screen.findByText(/Registries disagree/);
    await type("Add relay", "ws://other.i2p");
    expect(screen.queryByText(/Registries disagree/)).toBeNull();
  });

  it("shows a refused lookup beside the box, and refuses an address already listed", async () => {
    const lookup = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError("invalid_params", "no registry knows the name"),
      )
      .mockResolvedValue(i2pLookup());
    await setup({ relays: ["ws://127.0.0.1:7777", NAMED] }, "relays", lookup);
    await type("Add relay", "ws://nostr-not.i2p");
    await click("Look up");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "no registry knows the name",
    );
    await type("Add relay", "ws://nostr-not.i2p");
    await click("Look up");
    await click("Add as this address");
    expect(screen.getByRole("alert").textContent).toBe(
      "That relay is already listed.",
    );
  });

  it("looks a named relay up again: same address, a refusal, or a new one to move to", async () => {
    const lookup = vi
      .fn()
      .mockResolvedValueOnce(i2pLookup())
      .mockRejectedValueOnce(
        new ApiError("invalid_params", "no registry was reachable"),
      )
      .mockResolvedValue(
        i2pLookup({ address: OTHER, agreeing: REGISTRIES, unknown: [] }),
      );
    const rules = [
      {
        name: "",
        match: [NAMED, "*.onion"],
        keys: [],
        to: { proxy: "r" },
        fallback: "offline" as const,
      },
    ];
    const t = await setup(
      {
        relays: ["ws://127.0.0.1:7777", NAMED],
        relay_keys: { [NAMED]: ["invoices"] },
        relay_names: {
          [NAMED]: "nostr-not.i2p",
          "ws://127.0.0.1:7777": "local",
        },
        proxies: { ...settings().proxies, list: [TOR, ROUTER], rules },
      },
      "relays",
      lookup,
      false,
    );
    await screen.findByLabelText(`Name of ${NAMED}`);
    expect(nameOf(NAMED)).toBe("nostr-not.i2p");
    await click("Look up nostr-not.i2p again");
    expect(
      await screen.findByText("The address has not changed."),
    ).toBeTruthy();
    await click("Close");
    await click("Look up nostr-not.i2p again");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "no registry was reachable",
    );
    await click("Look up nostr-not.i2p again");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "The address has changed",
    );
    // Not confirmed: nothing moves.
    await click("Use the new address");
    expect(t.confirm).toHaveBeenCalledWith(
      `Replace ${NAMED} with ws://${OTHER}? Its keys, name and rules move to the new address.`,
    );
    expect(screen.getByText(NAMED)).toBeTruthy();
    t.confirm.mockReturnValue(true);
    await click("Use the new address");
    expect(screen.getByText(`ws://${OTHER}`)).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(t.updateNetwork).toHaveBeenCalled());
    const patch = patchOf(t);
    expect(patch.relays).toEqual(["ws://127.0.0.1:7777", `ws://${OTHER}`]);
    expect(patch.relay_keys).toEqual({ [`ws://${OTHER}`]: ["invoices"] });
    expect(patch.relay_names).toEqual({
      "ws://127.0.0.1:7777": "local",
      [`ws://${OTHER}`]: "nostr-not.i2p",
    });
    expect(patch.proxies.rules[0].match).toEqual([`ws://${OTHER}`, "*.onion"]);
  });

  it("will not move a relay onto an address already listed, and drops the name with the relay", async () => {
    const lookup = vi.fn().mockResolvedValue(i2pLookup({ address: OTHER }));
    const t = await setup(
      {
        relays: ["ws://127.0.0.1:7777", NAMED, `ws://${OTHER}`],
        relay_names: { [NAMED]: "nostr-not.i2p" },
      },
      "relays",
      lookup,
    );
    await click("Look up nostr-not.i2p again");
    await click("Use the new address");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "That relay is already listed.",
    );
    await click(`Remove ${NAMED}`);
    expect(screen.queryByLabelText(`Name of ${NAMED}`)).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(t.updateNetwork).toHaveBeenCalled());
    expect(patchOf(t)).toEqual({
      relays: ["ws://127.0.0.1:7777", `ws://${OTHER}`],
      relay_names: {},
    });
  });
});
