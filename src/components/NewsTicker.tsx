import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Newspaper } from 'lucide-react';
import { NewsItem } from '../game/types';

interface NewsTickerProps {
  news: NewsItem[];
  isMobile: boolean;
}

export const NewsTicker: React.FC<NewsTickerProps> = ({ news, isMobile }) => {
  const [collapsed, setCollapsed] = useState<boolean>(isMobile);
  const [lastSeenId, setLastSeenId] = useState<number>(0);

  useEffect(() => {
    if (!collapsed && news.length > 0) {
      setLastSeenId(news[0].id);
    }
  }, [collapsed, news]);

  const unreadCount = collapsed
    ? news.filter((item) => item.id > lastSeenId).length
    : 0;

  return (
    <div className="pointer-events-auto w-full max-w-[270px] sm:max-w-[300px] bg-[#0d1117]/88 backdrop-blur-md border border-slate-800 rounded-lg overflow-hidden shadow-lg">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full px-3 py-2 flex items-center justify-between text-xs font-semibold text-slate-200 hover:bg-slate-800/70 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Newspaper className="w-3.5 h-3.5 text-[#ffda1a]" />
          <span>Store News</span>
          {unreadCount > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-mono-tabular">
              {unreadCount}
            </span>
          )}
        </span>
        {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
      </button>

      {!collapsed && (
        <div className="max-h-[190px] sm:max-h-[240px] overflow-y-auto divide-y divide-slate-800/70 px-3 pb-2 text-[11px] leading-snug">
          {news.length === 0 ? (
            <p className="py-2 text-slate-500">Quiet aisles for now.</p>
          ) : (
            news.slice(0, 22).map((item) => (
              <div key={item.id} className="py-1.5">
                <span className="font-mono-tabular text-slate-500 mr-1.5">D{item.day}</span>
                <span className="font-semibold mr-1.5" style={{ color: item.color }}>
                  {item.category}
                </span>
                <span className="text-slate-200">{item.text}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
