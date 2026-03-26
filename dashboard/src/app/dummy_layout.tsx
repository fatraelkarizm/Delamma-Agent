import './globals.css';

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
          {/* We'll inject sidebar/header here but need styles first */}
          <main className="page-content">{children}</main>
        </div>
      </body>
    </html>
  );
}
