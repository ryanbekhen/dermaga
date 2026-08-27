#ifndef DERMAGA_TRAY_H
#define DERMAGA_TRAY_H

// trayApply draws the menu bar item: its icon and its hover text. Creates the
// item on the first call.
void trayApply(const unsigned char *icon, int iconLength, const char *tooltip);

// trayPositionWindow puts a window under the menu bar item, on the screen the
// item is on, `gap` points below the menu bar.
void trayPositionWindow(void *nsWindow, int gap);

// trayHighlight draws the menu bar item as pressed, for as long as the panel
// hanging from it is up.
void trayHighlight(int on);

#endif
