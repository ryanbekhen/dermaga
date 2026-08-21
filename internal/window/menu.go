package window

import "github.com/wailsapp/wails/v3/pkg/application"

// menuBar is what Dermaga puts in the macOS menu bar.
//
// Wails' own default menu is a browser's menu, because a Wails window is a
// browser: View carries Reload, Force Reload and the web inspector, and Help
// carries a link to wails.io. None of it belongs to an app for managing
// containers. Reload in particular is not harmless -- it throws away the
// window's state and reconnects to the agent for no reason anyone asked for,
// and somebody who presses it is not debugging, they are looking for a refresh
// button that this app deliberately does not have.
//
// So the menu is built here rather than inherited, and what is left is the part
// that is about the app rather than about the web:
//
//   - the application menu, for About, Hide and Quit
//   - File, for Close Window
//   - Edit, for cut, copy, paste and select-all in the fields that have them
//   - Window, for minimise and zoom
//
// Nothing else is missing by accident. Fullscreen is still the green button;
// zoom belongs to a document, and nothing here is one.
func menuBar() *application.Menu {
	menu := application.NewMenu()

	menu.AddRole(application.AppMenu)
	menu.AddRole(application.FileMenu)
	menu.AddRole(application.EditMenu)
	menu.AddRole(application.WindowMenu)

	return menu
}
