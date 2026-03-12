import type React from 'react';
import type uPlot from 'uplot';

export interface AnnotationData {
  id: string;
  site_id: string;
  parameter_id: string;
  start_time: string;
  end_time: string;
  text: string;
  category: string;
  created_by: string | null;
  created_at: string | null;
}

export const ANNOTATION_CATEGORY_COLORS: Record<string, string> = {
  maintenance: 'rgba(33, 150, 243, 0.18)',
  quality_issue: 'rgba(244, 67, 54, 0.18)',
  environmental: 'rgba(76, 175, 80, 0.18)',
  other: 'rgba(158, 158, 158, 0.18)',
};

export const ANNOTATION_CATEGORIES: { value: string; label: string }[] = [
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'quality_issue', label: 'Quality Issue' },
  { value: 'environmental', label: 'Environmental' },
  { value: 'other', label: 'Other' },
];

/**
 * uPlot plugin that draws semi-transparent colored bands for annotations.
 * Colors are based on annotation category.
 */
export const annotationBandsPlugin = (
  annotations: AnnotationData[],
): uPlot.Plugin => ({
  hooks: {
    draw: [
      (u: uPlot) => {
        if (annotations.length === 0) return;
        const ctx = u.ctx;
        const { left, top, width, height } = u.bbox;

        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();

        for (const ann of annotations) {
          const startSec = new Date(ann.start_time).getTime() / 1000;
          const endSec = new Date(ann.end_time).getTime() / 1000;
          const x0 = Math.max(left, u.valToPos(startSec, 'x', true));
          const x1 = Math.min(left + width, u.valToPos(endSec, 'x', true));
          if (x1 <= x0) continue;

          ctx.fillStyle = ANNOTATION_CATEGORY_COLORS[ann.category] || ANNOTATION_CATEGORY_COLORS.other;
          ctx.fillRect(x0, top, x1 - x0, height);
        }

        ctx.restore();
      },
    ],
  },
});

/**
 * uPlot plugin for annotation interaction: brush-to-annotate and hover tooltip.
 */
export const annotationInteractionPlugin = (
  tipRef: React.RefObject<HTMLDivElement | null>,
  annRef: React.RefObject<AnnotationData[]>,
  onSelect: (range: { start: Date; end: Date }) => void,
): uPlot.Plugin => ({
  hooks: {
    setSelect: [(u: uPlot) => {
      const sel = u.select;
      if (sel.width > 2) {
        const s = u.posToVal(sel.left, 'x');
        const e = u.posToVal(sel.left + sel.width, 'x');
        onSelect({ start: new Date(s * 1000), end: new Date(e * 1000) });
      }
    }],
    setCursor: [(u: uPlot) => {
      const tip = tipRef.current;
      if (!tip) return;
      const cx = u.cursor.left;
      if (cx == null || cx < 0) { tip.style.display = 'none'; return; }
      const cursorTime = u.posToVal(cx, 'x');
      const found = annRef.current?.find((a) => {
        const as0 = new Date(a.start_time).getTime() / 1000;
        const ae0 = new Date(a.end_time).getTime() / 1000;
        return cursorTime >= as0 && cursorTime <= ae0;
      });
      if (found) {
        const cat = ANNOTATION_CATEGORIES.find((c) => c.value === found.category)?.label || found.category;
        tip.style.display = 'block';
        tip.style.left = `${cx + 10}px`;
        tip.style.top = `${(u.cursor.top ?? 30)}px`;
        tip.innerHTML = `<strong>${cat}</strong><br/>${found.text}`;
      } else {
        tip.style.display = 'none';
      }
    }],
  },
});
