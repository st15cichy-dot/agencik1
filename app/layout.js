import "./globals.css";

export const metadata = {
  title: "Autonomiczny Inwestor v0.3",
  description: "Multi-strategy research lab, out-of-sample tests, walk-forward and paper trading.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
