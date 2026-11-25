<script lang="ts">
  import { destinations, groupName, proxyName, sameDestination } from '../lib/routes';
  import type { Destination, ProxySettings } from '../lib/schemas';

  // A choice of where relays go: a proxy, a group, direct or block.
  let {
    name,
    label,
    proxies,
    value,
    onpick,
    omit = [],
  }: {
    /** The radio group's name, unique on the page. */
    name: string;
    /** Its accessible name. */
    label: string;
    proxies: Pick<ProxySettings, 'list' | 'groups'>;
    value: Destination;
    onpick: (d: Destination) => void;
    /** Choices to leave out. */
    omit?: Destination[];
  } = $props();

  const options = $derived(destinations(proxies).filter((o) => !omit.some((d) => sameDestination(d, o))));
  const STRATEGY: Record<string, string> = { failover: 'Failover', round_robin: 'Round-robin', chaos: 'Chaos' };

  /** The choice's title and the line under it. */
  function text(d: Destination): [string, string] {
    if (d === 'direct') return ['Direct, no proxy', 'For relays on this network, or on FIPS.'];
    if (d === 'block') return ['Nowhere: block', 'Never connect to these relays, even if they are listed.'];
    if ('proxy' in d) return [`Through ${proxyName(proxies.list.find((e) => e.id === d.proxy)!)}`, ''];
    const g = proxies.groups.find((x) => x.id === d.group)!;
    const members = g.proxies.map((id) => proxies.list.find((e) => e.id === id)).filter((e) => e !== undefined);
    return [`Group ${groupName(g)}`, `${STRATEGY[g.strategy]}: ${members.map(proxyName).join(', ')}`];
  }
</script>

<div class="rule-choices" role="radiogroup" aria-label={label}>
  {#each options as o (JSON.stringify(o))}
    {@const [title, line] = text(o)}
    <label class="rule-choice" class:on={sameDestination(o, value)}>
      <input type="radio" {name} checked={sameDestination(o, value)} onchange={() => onpick(o)} />
      <span>{title}{#if line !== ''}<small>{line}</small>{/if}</span>
    </label>
  {/each}
</div>
