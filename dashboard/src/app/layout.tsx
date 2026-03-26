import './globals.css';
import './layout.css';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';

export const metadata = {
  title: 'DLMM Bot Dashboard',
  description: 'Control your DLMM bot operations',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="app-container">
          <Sidebar />
          <div className="main-content">
            <Header />
            <main className="page-content">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
