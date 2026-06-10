import "./globals.css";

export const metadata = {
  title: "Affiliate Outreach Queue",
  description: "Threads-first affiliate dashboard for Shopee products",
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
