import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

// Shared popup shown when the backend rejects a material/recording upload
// with code "BETA_LIMIT_REACHED" (see MAX_BETA_ACTIONS in
// artifacts/api-server/src/lib/tokens.ts) -- one component so the beta-cap
// message stays consistent across every upload entry point instead of being
// duplicated per page.
export function BetaLimitDialog({
  open,
  onOpenChange,
  isRTL,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isRTL: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent dir={isRTL ? "rtl" : "ltr"}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isRTL ? "🙏 תודה שעוזרים לנו!" : "🙏 Thanks for helping us test!"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isRTL
              ? "הגעת למגבלת הבטא החינמית! תודה שעזרת לנו לבדוק את האתר 🙏"
              : "You've reached the free beta limit! Thanks so much for helping us test the site 🙏"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => onOpenChange(false)}>
            {isRTL ? "הבנתי" : "Got it"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
