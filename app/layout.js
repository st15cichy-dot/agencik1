import "./globals.css";

export const metadata = {
  title: "Autonomiczny Inwestor v0.12",
  description: "Autonomous paper research with shadow allocation intelligence, strategy governance and hard risk controls.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
