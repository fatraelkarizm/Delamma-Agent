"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { Search, Filter, Download, Plus, Edit2, ExternalLink } from 'lucide-react';
import styles from './PositionsTable.module.css';

export default function PositionsTable({ positions }: { positions: any[] }) {
  const [search, setSearch] = useState('');

  const filtered = positions.filter((p: any) =>
    (p.pool_name || p.pool || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>Active Positions</h3>
        <div className={styles.actions}>
          <div className={styles.search}>
            <Search size={16} className={styles.searchIcon} />
            <input
              type="text"
              placeholder="Search Pool..."
              className={styles.searchInput}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button className={styles.actionBtn}><Filter size={16} /> Filter</button>
          <button className={styles.actionBtn}><Download size={16} /> Export</button>
          <button className={styles.primaryBtn}><Plus size={16} /> Deploy New</button>
        </div>
      </div>

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th><input type="checkbox" className={styles.checkbox} /></th>
              <th>Position</th>
              <th>Pool Pair</th>
              <th>Strategy</th>
              <th>TVL (SOL)</th>
              <th>Value (USD)</th>
              <th>Fees Earned</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className={styles.emptyRow}>
                  {positions.length === 0
                    ? 'No open positions. Deploy a position to get started!'
                    : 'No positions match your search.'}
                </td>
              </tr>
            ) : (
              filtered.map((item: any, i: number) => {
                const poolName = item.pool_name || item.pool?.substring(0, 12) || 'Unknown';
                const oor = item.out_of_range_since;
                const isOOR = !!oor;
                return (
                  <tr key={i}>
                    <td><input type="checkbox" className={styles.checkbox} /></td>
                    <td className={styles.colProduct}>
                      <div className={styles.iconSquare}>{poolName.charAt(0).toUpperCase()}</div>
                      <span className={styles.fontWeight600} title={item.position}>
                        {(item.position || '').substring(0, 12)}…
                      </span>
                    </td>
                    <td className={styles.poolName}>{poolName}</td>
                    <td>
                      <span className={styles.strategyBadge}>{item.strategy || 'spot'}</span>
                    </td>
                    <td>
                      <span className={`${styles.badge} ${(item.amount_sol ?? 0) > 0.5 ? styles.badgeGreen : styles.badgeGray}`}>
                        {item.amount_sol ?? '—'}
                      </span>
                    </td>
                    <td className={styles.fontWeight600}>
                      ${(item.initial_value_usd || 0).toFixed(2)}
                    </td>
                    <td className={styles.fontWeight600}>
                      ${(item.total_fees_claimed_usd || 0).toFixed(2)}
                    </td>
                    <td>
                      <span className={`${styles.statusBadge} ${isOOR ? styles.statusOOR : styles.statusActive}`}>
                        {isOOR ? '⚠ OOR' : '✓ Active'}
                      </span>
                    </td>
                    <td>
                      <div className={styles.actionBtns}>
                        <button className={styles.editBtn}><Edit2 size={13} /></button>
                        <a
                          href={`https://solscan.io/account/${item.position}`}
                          target="_blank"
                          rel="noreferrer"
                          className={styles.editBtn}
                        ><ExternalLink size={13} /></a>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.pagination}>
        <div className={styles.showingText}>
          Showing {filtered.length} of {positions.length} position{positions.length !== 1 ? 's' : ''}
        </div>
      </div>
    </div>
  );
}
