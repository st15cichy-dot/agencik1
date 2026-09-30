import "./globals.css";

export const metadata = {
  title: "Autonomiczny Inwestor v0.5.1",
  description: "Deep OOS validation with historical regime diagnostics and safer risk metrics.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
