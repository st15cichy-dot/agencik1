import "./globals.css";

export const metadata = {
  title: "Autonomiczny Inwestor v0.13",
  description: "Autonomous paper research with a 16-market research universe, shadow expansion and hard risk controls.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
