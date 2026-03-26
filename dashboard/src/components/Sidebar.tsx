import Link from 'next/link';
import { LayoutDashboard, Wallet, BarChart3, Settings, Activity, Layers, HelpCircle } from 'lucide-react';
import styles from './Sidebar.module.css';

export default function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <div className={styles.logoIcon}>DL</div>
        <span className={styles.logoText}>DLMM Bot</span>
      </div>

      <div className={styles.navSection}>
        <div className={styles.navTitle}>MAIN MENU</div>
        <ul className={styles.navList}>
          <li className={`${styles.navItem} ${styles.active}`}>
            <Link href="/" className={styles.navLink}>
              <LayoutDashboard size={20} />
              <span>Dashboard</span>
            </Link>
          </li>
          <li className={styles.navItem}>
            <Link href="#" className={styles.navLink}>
              <Wallet size={20} />
              <span>Positions</span>
            </Link>
          </li>
          <li className={styles.navItem}>
            <Link href="#" className={styles.navLink}>
              <Layers size={20} />
              <span>Pools</span>
            </Link>
          </li>
          <li className={styles.navItem}>
            <Link href="#" className={styles.navLink}>
              <Activity size={20} />
              <span>Activity Log</span>
            </Link>
          </li>
          <li className={styles.navItem}>
            <Link href="#" className={styles.navLink}>
              <BarChart3 size={20} />
              <span>Analytics</span>
            </Link>
          </li>
        </ul>
      </div>

      <div className={styles.navSection}>
        <div className={styles.navTitle}>OTHER</div>
        <ul className={styles.navList}>
          <li className={styles.navItem}>
            <Link href="#" className={styles.navLink}>
              <HelpCircle size={20} />
              <span>Help Center</span>
            </Link>
          </li>
          <li className={styles.navItem}>
            <Link href="#" className={styles.navLink}>
              <Settings size={20} />
              <span>Settings</span>
            </Link>
          </li>
        </ul>
      </div>

      <div className={styles.userProfile}>
        <div className={styles.avatar}></div>
        <div className={styles.userInfo}>
          <div className={styles.userName}>Bot Operator</div>
          <div className={styles.userRole}>Admin</div>
        </div>
      </div>
    </aside>
  );
}
