import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type React from "react";

interface DatePickerProps {
  value: string;
  onChange: (date: string) => void;
  className?: string;
  mode?: "date" | "datetime";
}

const DatePicker: React.FC<DatePickerProps> = ({
  value,
  onChange,
  className = "",
  mode = "date",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const parseValueToDate = (raw: string) => {
    if (!raw) return null;

    if (mode === "datetime") {
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const [year, month, day] = raw.split("-").map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
  };

  // Parse initial value or default to today
  const parsedValueDate = parseValueToDate(value);
  const initialDate = parsedValueDate ?? new Date();
  const [viewDate, setViewDate] = useState(initialDate);

  const daysOfWeek = ["日", "一", "二", "三", "四", "五", "六"];

  const getSelectedTime = () => {
    if (mode !== "datetime") return "12:00";
    const parsed = parseValueToDate(value);
    if (!parsed) {
      const now = new Date();
      return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    }
    return `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    return new Date(year, month, 1).getDay();
  };

  const changeMonth = (offset: number) => {
    const newDate = new Date(
      viewDate.getFullYear(),
      viewDate.getMonth() + offset,
      1,
    );
    setViewDate(newDate);
  };

  const handleDayClick = (day: number) => {
    const year = viewDate.getFullYear();
    const month = (viewDate.getMonth() + 1).toString().padStart(2, "0");
    const dayStr = day.toString().padStart(2, "0");
    const dateString = `${year}-${month}-${dayStr}`;

    if (mode === "datetime") {
      onChange(`${dateString}T${getSelectedTime()}`);
    } else {
      onChange(dateString);
      setIsOpen(false);
    }
  };

  const handleTimeChange = (timeValue: string) => {
    if (mode !== "datetime") return;

    const selected = parseValueToDate(value);
    const baseDate = selected ?? viewDate;
    const year = baseDate.getFullYear();
    const month = String(baseDate.getMonth() + 1).padStart(2, "0");
    const day = String(baseDate.getDate()).padStart(2, "0");
    onChange(`${year}-${month}-${day}T${timeValue}`);
  };

  const isSelected = (day: number) => {
    if (!value) return false;
    const currentYear = viewDate.getFullYear();
    const currentMonth = viewDate.getMonth();
    const datePart = mode === "datetime" ? value.split("T")[0] : value;
    const [vYear, vMonth, vDay] = datePart.split("-").map(Number);
    return vYear === currentYear && vMonth - 1 === currentMonth && vDay === day;
  };

  const isToday = (day: number) => {
    const today = new Date();
    return (
      today.getDate() === day &&
      today.getMonth() === viewDate.getMonth() &&
      today.getFullYear() === viewDate.getFullYear()
    );
  };

  const renderCalendar = () => {
    const daysInMonth = getDaysInMonth(viewDate);
    const firstDay = getFirstDayOfMonth(viewDate);
    const slots = [];

    for (let i = 0; i < firstDay; i++) {
      slots.push(<div key={`empty-${i}`} className="w-8 h-8"></div>);
    }

    for (let i = 1; i <= daysInMonth; i++) {
      const selected = isSelected(i);
      const today = isToday(i);

      slots.push(
        <button
          key={i}
          onClick={() => handleDayClick(i)}
          className={`
            w-8 h-8 text-[11px] font-mono flex items-center justify-center transition-all relative
            ${
              selected
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            }
            ${today && !selected ? "text-foreground font-medium" : ""}
          `}
        >
          {i}
          {today && !selected && (
            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-px bg-foreground"></div>
          )}
        </button>,
      );
    }

    return slots;
  };

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        className={`
            relative w-full bg-transparent border-b border-border/40 text-sm font-light pl-8 pr-4 py-3 cursor-pointer select-none transition-all
            ${isOpen ? "border-foreground" : "hover:border-foreground/50"}
        `}
      >
        <CalendarIcon
          className={`absolute left-0 top-1/2 -translate-y-1/2 transition-colors ${
            isOpen ? "text-foreground" : "text-muted-foreground/50"
          }`}
          size={14}
          strokeWidth={1.5}
        />
        <span className={value ? "opacity-100" : "opacity-40"}>
          {value || (mode === "datetime" ? "选择日期和时间" : "选择日期")}
        </span>
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 z-50 mt-2 bg-popover border border-border/30 p-4 w-70 animate-in fade-in duration-200">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-serif font-medium text-foreground">
              {viewDate.toLocaleString("zh-CN", {
                month: "long",
                year: "numeric",
              })}
            </h4>
            <div className="flex items-center gap-1">
              <button
                onClick={() => changeMonth(-1)}
                className="text-muted-foreground/50 hover:text-foreground transition-colors p-1"
              >
                <ChevronLeft size={14} strokeWidth={1.5} />
              </button>
              <button
                onClick={() => changeMonth(1)}
                className="text-muted-foreground/50 hover:text-foreground transition-colors p-1"
              >
                <ChevronRight size={14} strokeWidth={1.5} />
              </button>
            </div>
          </div>

          {/* Grid Header (Days) */}
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {daysOfWeek.map((d) => (
              <div
                key={d}
                className="w-8 text-center text-[9px] font-mono text-muted-foreground/40 uppercase"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Grid Body */}
          <div className="grid grid-cols-7 gap-0.5">{renderCalendar()}</div>

          {mode === "datetime" && (
            <div className="mt-4 pt-3 border-t border-border/30 space-y-2">
              <label className="text-[10px] font-mono text-muted-foreground block">
                时间（分钟）
              </label>
              <input
                type="time"
                step={60}
                value={getSelectedTime()}
                onChange={(e) => handleTimeChange(e.target.value)}
                className="w-full bg-transparent border border-border/40 text-xs font-mono px-2 py-1 focus:outline-none focus:border-foreground"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DatePicker;
