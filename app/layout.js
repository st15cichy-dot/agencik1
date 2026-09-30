import "./globals.css";

export const metadata = {
  title: "Autonomiczny Inwestor",
  description: "Panel badawczy i paper trading — bez realnych transakcji.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
