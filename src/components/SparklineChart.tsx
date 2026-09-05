import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";

import type { SparkPoint } from "./Sparkline";

/**
 * The lazy recharts half of `Sparkline` — imported only when real points
 * exist, keeping recharts out of the startup bundle.
 */
export default function SparklineChart({
  points,
  height,
  color,
}: {
  points: SparkPoint[];
  height: number;
  color: string;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.45} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={["dataMin - 2", "dataMax + 2"]} />
          <Tooltip
            cursor={{ stroke: "#31353f" }}
            contentStyle={{
              background: "#0a0e17",
              border: "1px solid #31353f",
              borderRadius: 8,
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 11,
            }}
            labelFormatter={(value) =>
              new Date(Number(value)).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })
            }
            formatter={(value) => [`${Number(value).toFixed(1)} WPM`, "daily avg"]}
          />
          <Area
            type="monotone"
            dataKey="y"
            data={points}
            stroke={color}
            strokeWidth={2}
            fill="url(#sparkFill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
