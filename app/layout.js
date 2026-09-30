import "./globals.css";

export const metadata = {
  title: "Autonomiczny Inwestor v0.6",
  description: "Autonomous research heartbeat, durable public research memory and deep validation.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
