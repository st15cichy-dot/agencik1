import "./globals.css";

export const metadata = {
  title: "Autonomiczny Inwestor v0.2",
  description: "Live market data, deterministic scanner, backtesting and paper trading.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
