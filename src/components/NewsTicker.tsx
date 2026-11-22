import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Newspaper } from 'lucide-react';
import { ChronicleEntry, NewsItem } from '../game/types';

interface NewsTickerProps {
  news: NewsItem[];
  chronicle?: ChronicleEntry[];
  isMobile: boolean;
}

export const NewsTicker: React.FC<NewsTickerProps> = ({ news, chronicle = [], isMobile }) => {
  const [collapsed, setCollapsed] = useState<boolean>(isMobile);
  const [tab, setTab] = useState<'news' | 'chronicle'>('news');
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
        <div>
          <div className="flex border-t border-b border-slate-800/90 text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setTab('news')}
              className={`flex-1 py-1.5 transition-colors ${
                tab === 'news'
                  ? 'bg-slate-800/80 text-[#ffda1a]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Turn Log ({news.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('chronicle')}
              className={`flex-1 py-1.5 transition-colors border-l border-slate-800/90 ${
                tab === 'chronicle'
                  ? 'bg-slate-800/80 text-[#ffda1a]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Chronicle ({chronicle.length})
            </button>
          </div>

          <div className="max-h-[190px] sm:max-h-[240px] overflow-y-auto divide-y divide-slate-800/70 px-3 pb-2 text-[11px] leading-snug">
            {tab === 'news' ? (
              news.length === 0 ? (
                <p className="py-2 text-slate-500">Quiet aisles for now.</p>
              ) : (
                news.slice(0, 26).map((item) => (
                  <div key={item.id} className="py-1.5">
                    <span className="font-mono-tabular text-slate-500 mr-1.5">D{item.day}</span>
                    <span className="font-semibold mr-1.5" style={{ color: item.color }}>
                      {item.category}
                    </span>
                    <span className="text-slate-200">{item.text}</span>
                  </div>
                ))
              )
            ) : chronicle.length === 0 ? (
              <p className="py-2 text-slate-500">No major milestones recorded yet.</p>
            ) : (
              chronicle.slice(0, 26).map((entry) => (
                <div key={entry.id} className="py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono-tabular text-slate-500">D{entry.day}</span>
                    <span className="font-semibold truncate" style={{ color: entry.color }}>
                      {entry.title}
                    </span>
                  </div>
                  <p className="text-slate-300 mt-0.5">{entry.detail}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
