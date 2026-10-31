#!/usr/bin/env bash
# Refuse iCloud Private Relay at the network edge, so Safari shows its own
# "Private Relay is unable to hide your IP address … Show IP Address" sheet
# and the user reconnects with their real IP (the app-level guard in
# apps/web/src/lib/network-guard blocks relay too, as a fallback page).
#
# How: Apple publishes every Private Relay egress range. We load them into two
# ipsets (v4/v6) and TCP-reset web connections from them. Safari treats the
# refused relayed connection as "this site needs your IP" and offers the
# direct connection.
#
# Idempotent and safe to re-run: new ranges load into scratch sets that are
# swapped in atomically, and the iptables rules are only added once.
#
# Usage (root, on the VPS):
#   sudo deploy/scripts/block-private-relay.sh                 # all addresses on this box
#   sudo deploy/scripts/block-private-relay.sh --dest 1.2.3.4 --dest6 2a02::1  # only traffic to these IPs
#   sudo deploy/scripts/block-private-relay.sh --remove        # undo everything
#
# The VPS also serves amscoins.com from the same address, so without --dest
# Private Relay users are refused on BOTH sites. Give indianxtrade.com its own
# IP and pass it with --dest to scope the block to this site only.
#
# Requires: ipset, iptables/ip6tables, curl. Refresh daily (Apple rotates
# ranges) — see deploy/DEPLOY.md for the systemd timer.
#
# NOTE: if the site is ever put behind Cloudflare, the origin only sees
# Cloudflare's IPs and this script does nothing; use a Cloudflare WAF rule on
# the same list instead (docs/security/ddos-plan.md).
set -euo pipefail

LIST_URL="https://mask-api.icloud.com/egress-ip-ranges.csv"
SET4="private_relay4"
SET6="private_relay6"
COMMENT="asm-private-relay"
MAXELEM=2097152
DEST4=""
DEST6=""
REMOVE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest) DEST4="$2"; shift 2 ;;
    --dest6) DEST6="$2"; shift 2 ;;
    --remove) REMOVE=1; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ -n "$DEST4" && -z "$DEST6" && $REMOVE -eq 0 ]]; then
  echo "note: --dest scopes IPv4 only; pass --dest6 <addr> to scope IPv6 too (else IPv6 blocks box-wide)" >&2
fi

[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }
for bin in ipset iptables ip6tables curl; do
  command -v "$bin" >/dev/null || { echo "missing $bin (apt install ipset iptables curl)" >&2; exit 1; }
done

# Build "iptables args" for one family; destination is optional.
rule_args() {
  local set="$1" dest="$2" proto="$3" reject="$4"
  local args=(-p "$proto" -m multiport --dports "80,443" -m set --match-set "$set" src)
  [[ -n "$dest" ]] && args+=(-d "$dest")
  args+=(-m comment --comment "$COMMENT" -j REJECT --reject-with "$reject")
  printf '%s\n' "${args[@]}"
}

apply_rule() {
  local tool="$1"; shift
  local args=()
  while IFS= read -r a; do args+=("$a"); done
  if [[ $REMOVE -eq 1 ]]; then
    while "$tool" -D INPUT "${args[@]}" 2>/dev/null; do :; done
  elif ! "$tool" -C INPUT "${args[@]}" 2>/dev/null; then
    "$tool" -I INPUT 1 "${args[@]}"
  fi
}

rules() {
  # TCP gets a reset (fast, unambiguous failure for Safari); UDP/443 covers
  # HTTP/3 should it ever be enabled in nginx.
  rule_args "$SET4" "$DEST4" tcp tcp-reset | apply_rule iptables
  rule_args "$SET4" "$DEST4" udp icmp-port-unreachable | apply_rule iptables
  rule_args "$SET6" "$DEST6" tcp tcp-reset | apply_rule ip6tables
  rule_args "$SET6" "$DEST6" udp icmp6-port-unreachable | apply_rule ip6tables
}

if [[ $REMOVE -eq 1 ]]; then
  rules
  ipset destroy "$SET4" 2>/dev/null || true
  ipset destroy "$SET6" 2>/dev/null || true
  echo "Private Relay block removed."
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"; ipset destroy "${SET4}_new" 2>/dev/null || true; ipset destroy "${SET6}_new" 2>/dev/null || true' EXIT

curl -fsSL --retry 3 --max-time 120 "$LIST_URL" -o "$tmp/ranges.csv"
# Column 1 is the CIDR. Refuse to swap in a suspiciously small list (a bad
# download would otherwise silently un-block everyone).
cut -d, -f1 "$tmp/ranges.csv" | grep -E '^[0-9]+\.[0-9.]+/[0-9]+$' | sort -u > "$tmp/v4"
cut -d, -f1 "$tmp/ranges.csv" | grep -E '^[0-9a-fA-F:]+:[0-9a-fA-F:]*/[0-9]+$' | sort -u > "$tmp/v6"
n4=$(wc -l < "$tmp/v4"); n6=$(wc -l < "$tmp/v6")
if (( n4 < 1000 || n6 < 1000 )); then
  echo "egress list looks wrong (v4=$n4 v6=$n6); keeping current sets" >&2
  exit 1
fi

ipset create -exist "$SET4" hash:net family inet maxelem "$MAXELEM"
ipset create -exist "$SET6" hash:net family inet6 maxelem "$MAXELEM"
ipset destroy "${SET4}_new" 2>/dev/null || true
ipset destroy "${SET6}_new" 2>/dev/null || true
{
  echo "create ${SET4}_new hash:net family inet maxelem $MAXELEM"
  sed "s/^/add ${SET4}_new /" "$tmp/v4"
  echo "create ${SET6}_new hash:net family inet6 maxelem $MAXELEM"
  sed "s/^/add ${SET6}_new /" "$tmp/v6"
} | ipset restore -exist

ipset swap "${SET4}_new" "$SET4"
ipset swap "${SET6}_new" "$SET6"

rules
echo "Private Relay block active: $n4 IPv4 + $n6 IPv6 ranges${DEST4:+ (dest $DEST4)}."
