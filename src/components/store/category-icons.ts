import {
  Code2,
  MessageSquareText,
  ScanEye,
  Shapes,
  type LucideIcon,
} from "lucide-react";
import type { ModelCategory } from "@/lib/billing/pricing";

export const CATEGORY_ICONS: Record<ModelCategory, LucideIcon> = {
  text: MessageSquareText,
  code: Code2,
  vision: ScanEye,
  other: Shapes,
};
