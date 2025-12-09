import { motion } from "framer-motion";

const TICKER_DATA = [
  { symbol: "BTC", price: "98,432.10", change: "+2.4%", up: true },
  { symbol: "ETH", price: "3,892.45", change: "+1.2%", up: true },
  { symbol: "SPX", price: "5,892.10", change: "-0.4%", up: false },
  { symbol: "NDX", price: "18,432.50", change: "-0.8%", up: false },
  { symbol: "EUR/USD", price: "1.0842", change: "+0.1%", up: true },
  { symbol: "GOLD", price: "2,432.10", change: "+0.5%", up: true },
  { symbol: "OIL", price: "78.40", change: "-1.2%", up: false },
  { symbol: "TSLA", price: "245.30", change: "+3.4%", up: true },
  { symbol: "NVDA", price: "142.10", change: "+1.1%", up: true },
];

export default function MarketTicker() {
  return (
    <div className="w-full bg-slate-950 border-b border-border/50 overflow-hidden py-2 flex items-center h-10 select-none">
      <div className="flex whitespace-nowrap">
        {/* Double the list for seamless loop */}
        {[...TICKER_DATA, ...TICKER_DATA, ...TICKER_DATA].map((item, i) => (
          <motion.div
            key={i}
            initial={{ x: 0 }}
            animate={{ x: "-100%" }}
            transition={{ 
              repeat: Infinity, 
              ease: "linear", 
              duration: 30 
            }}
            className="flex items-center gap-2 mx-6 text-sm font-mono"
          >
            <span className="font-bold text-slate-400">{item.symbol}</span>
            <span className="text-white">{item.price}</span>
            <span className={item.up ? "text-emerald-500" : "text-rose-500"}>
              {item.change}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}