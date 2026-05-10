#!/usr/bin/env python3
"""
fetch_metagraph.py — Bittensor Hub metagraph snapshot collector
Appelé par GitHub Actions toutes les 10 min.

Produit :
  data/meta_sn26.json       -> etat courant SN26 (UID 129)
  data/meta_sn85.json       -> etat courant SN85 (UID 251)
  data/history_sn26.json    -> 7 jours glissants de snapshots SN26 (1008 pts max)
  data/history_sn85.json    -> 7 jours glissants de snapshots SN85

Compatibilite : bittensor >= 10.x  |  async-substrate-interface == 1.6.4
"""

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Configuration
SUBNETS = [
    {
        "netuid":  26,
        "uid":     129,
        "name":    "Perturb",
        "meta_out":    "data/meta_sn26.json",
        "history_out": "data/history_sn26.json",
        "pm2_services": ["perturb-miner", "sn26-optimizer", "sn26-monitor"],
    },
    {
        "netuid":  85,
        "uid":     251,
        "name":    "Vidaio",
        "meta_out":    "data/meta_sn85.json",
        "history_out": "data/history_sn85.json",
        "pm2_services": ["video-miner", "video-upscaler", "video-compressor",
                         "video-deleter", "sn85-optimizer", "dashboard"],
    },
]

NETWORK          = "finney"
MAX_RETRIES      = 3
RETRY_DELAY      = 10
HISTORY_MAX_PTS  = 1008   # 7 jours x 144 pts/jour
LEADERBOARD_TOP  = 20


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_json(path):
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            pass
    return None


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))


def safe_float(val, default=None):
    try:
        return float(val)
    except Exception:
        return default


def safe_int(val, default=None):
    try:
        return int(val)
    except Exception:
        return default


def fetch_subnet(netuid, target_uid, name, sub):
    """Requete on-chain et construction du snapshot brut."""
    mg  = sub.metagraph(netuid=netuid)
    n   = mg.n.item()
    uids = [safe_int(u) for u in mg.uids.tolist()]

    # Trouver notre index
    our_idx = None
    for i, uid in enumerate(uids):
        if uid == target_uid:
            our_idx = i
            break

    our_incentive = safe_float(mg.incentive[our_idx].item()) if our_idx is not None else None
    our_trust     = safe_float(mg.trust[our_idx].item())     if our_idx is not None else None
    our_rank_val  = safe_float(mg.ranks[our_idx].item())     if our_idx is not None else None
    our_emission  = safe_float(mg.emission[our_idx].item())  if our_idx is not None else None
    our_stake     = safe_float(mg.S[our_idx].item())         if our_idx is not None else None

    # Classement par incentive decroissant -> rang 1-based
    sorted_by_inc = sorted(
        [(uids[i], safe_float(mg.incentive[i].item(), 0.0)) for i in range(n)],
        key=lambda x: x[1],
        reverse=True,
    )
    rank_map = {uid: rank + 1 for rank, (uid, _) in enumerate(sorted_by_inc)}
    our_rank = rank_map.get(target_uid)

    # Leaderboard top-N
    leaderboard = []
    for rank, (uid, inc) in enumerate(sorted_by_inc[:LEADERBOARD_TOP], start=1):
        idx = uids.index(uid) if uid in uids else None
        leaderboard.append({
            "rank":      rank,
            "uid":       uid,
            "incentive": inc,
            "trust":     safe_float(mg.trust[idx].item()) if idx is not None else None,
            "is_us":     uid == target_uid,
        })

    return {
        "generated_at":   now_iso(),
        "netuid":         netuid,
        "name":           name,
        "our_uid":        target_uid,
        "our_rank":       our_rank,
        "our_rank_prev":  None,
        "rank_delta":     None,
        "our_incentive":  our_incentive,
        "our_trust":      our_trust,
        "our_rank_val":   our_rank_val,
        "our_emission":   our_emission,
        "our_stake":      our_stake,
        "total_neurons":  n,
        "block":          safe_int(mg.block.item()),
        "pm2_services":   {},
        "alerts":         [],
        "leaderboard":    leaderboard,
    }


def enrich_with_delta(snap, prev_meta):
    """Compare rang/incentive avec le snapshot precedent."""
    if prev_meta is None:
        return snap

    prev_rank = prev_meta.get("our_rank")
    prev_inc  = prev_meta.get("our_incentive")

    snap["our_rank_prev"] = prev_rank

    if snap["our_rank"] is not None and prev_rank is not None:
        snap["rank_delta"] = prev_rank - snap["our_rank"]  # positif = montee

    # Alertes automatiques
    alerts = []
    if snap["our_incentive"] is not None and prev_inc is not None:
        drop = prev_inc - snap["our_incentive"]
        if drop > 0.01:
            alerts.append({
                "level": "warning",
                "msg": "Incentive drop: %.6f -> %.6f (-%.6f)" % (
                    prev_inc, snap["our_incentive"], drop),
                "ts": snap["generated_at"],
            })
    if snap["our_rank"] is not None and snap["our_rank"] > 200:
        alerts.append({
            "level": "info",
            "msg":   "Rank #%d -- outside top 200" % snap["our_rank"],
            "ts":    snap["generated_at"],
        })
    snap["alerts"] = alerts
    return snap


def update_history(history_path, snap):
    """Charge l'historique, ajoute le snapshot courant, tronque a 7 jours."""
    existing = load_json(history_path)
    if not isinstance(existing, list):
        existing = []

    entry = {
        "ts":        snap["generated_at"],
        "block":     snap.get("block"),
        "our_rank":  snap.get("our_rank"),
        "incentive": snap.get("our_incentive"),
        "trust":     snap.get("our_trust"),
        "emission":  snap.get("our_emission"),
    }

    existing.insert(0, entry)
    existing = existing[:HISTORY_MAX_PTS]
    write_json(history_path, existing)
    return existing


def main():
    import bittensor as bt

    repo_root = Path(__file__).parent.parent
    print("[fetch_metagraph] Start -- %s" % now_iso())
    print("  bittensor version: %s" % bt.__version__)

    # Connexion subtensor
    sub = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            print("  Connecting to %s (attempt %d/%d)..." % (NETWORK, attempt, MAX_RETRIES))
            sub = bt.subtensor(NETWORK)
            print("  Connected -- block #%d" % sub.block)
            break
        except Exception as exc:
            print("  Connection failed: %s" % exc)
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY)

    if sub is None:
        print("CRITICAL: Could not connect to subtensor -- aborting")
        sys.exit(1)

    errors = []

    for cfg in SUBNETS:
        netuid   = cfg["netuid"]
        uid      = cfg["uid"]
        name     = cfg["name"]
        meta_out = repo_root / cfg["meta_out"]
        hist_out = repo_root / cfg["history_out"]

        print("\n[SN%d] Fetching metagraph (UID=%d)..." % (netuid, uid))

        prev_meta = load_json(meta_out)

        snap = None
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                snap = fetch_subnet(netuid, uid, name, sub)
                break
            except Exception as exc:
                print("  Attempt %d failed: %s" % (attempt, exc))
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_DELAY)

        if snap is None:
            msg = "SN%d: all %d attempts failed" % (netuid, MAX_RETRIES)
            print("  ERROR: %s" % msg)
            errors.append(msg)
            degraded = {
                "generated_at":  now_iso(),
                "netuid":        netuid,
                "name":          name,
                "our_uid":       uid,
                "our_rank":      None,
                "our_rank_prev": None,
                "rank_delta":    None,
                "our_incentive": None,
                "our_trust":     None,
                "pm2_services":  {},
                "alerts": [{"level": "critical",
                             "msg": "Metagraph fetch failed -- chain unreachable",
                             "ts":  now_iso()}],
                "leaderboard":   [],
                "error":         msg,
            }
            write_json(meta_out, degraded)
            continue

        snap = enrich_with_delta(snap, prev_meta)
        write_json(meta_out, snap)
        update_history(hist_out, snap)

        rank_str  = "#%d" % snap["our_rank"]  if snap["our_rank"]      is not None else "N/A"
        inc_str   = "%.8f" % snap["our_incentive"] if snap["our_incentive"] is not None else "N/A"
        delta_str = "%+d" % snap["rank_delta"] if snap["rank_delta"]   is not None else "N/A"
        print("  SN%d -- rank=%s (delta=%s)  incentive=%s  block=%s" % (
            netuid, rank_str, delta_str, inc_str, snap["block"]))

    print("\n[fetch_metagraph] Done -- %s" % now_iso())
    if errors:
        print("WARNINGS (%d subnet(s) had errors):" % len(errors))
        for e in errors:
            print("  * %s" % e)
    else:
        print("All subnets fetched successfully")


if __name__ == "__main__":
    main()
