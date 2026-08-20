#ifndef DERMAGA_TRAY_H
#define DERMAGA_TRAY_H

// One row of the menu, flattened to something C can carry.
typedef struct {
	const char *title;
	int tag;
	int enabled;
	int separator;
} DermagaTrayItem;

// trayApply draws the menu bar item: its icon, its tooltip and its whole menu,
// in one go. Creates the item on the first call.
void trayApply(const unsigned char *icon, int iconLength, const char *tooltip,
               DermagaTrayItem *items, int count);

#endif
