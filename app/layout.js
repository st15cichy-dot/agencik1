import "./globals.css";

export const metadata = {
  title: "Autonomiczny Inwestor v0.5",
  description: "Deep OOS validation, purged walk-forward, regime analysis and exposure-adjusted benchmark.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
