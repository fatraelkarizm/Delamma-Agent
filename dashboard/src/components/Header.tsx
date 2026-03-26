import { Search, Bell, Moon, Sun, Monitor } from 'lucide-react';
import styles from './Header.module.css';

export default function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.breadcrumb}>
        <span className={styles.muted}>Main Menu</span>
        <span className={styles.separator}>/</span>
        <span className={styles.current}>Dashboard</span>
      </div>

      <div className={styles.actions}>
        <div className={styles.search}>
          <Search size={18} className={styles.searchIcon} />
          <input type="text" placeholder="Search..." className={styles.searchInput} />
          <div className={styles.shortcut}>Ctrl K</div>
        </div>

        <button className={styles.actionBtn}>
          <Monitor size={18} />
          <span>Bot Control</span>
        </button>

        <div className={styles.iconButtons}>
          <button className={styles.iconBtn}>
            <Bell size={20} />
          </button>
          <div className={styles.themeToggle}>
            <button className={`${styles.themeBtn} ${styles.active}`}><Sun size={16} /></button>
            <button className={styles.themeBtn}><Moon size={16} /></button>
          </div>
        </div>
      </div>
    </header>
  );
}
