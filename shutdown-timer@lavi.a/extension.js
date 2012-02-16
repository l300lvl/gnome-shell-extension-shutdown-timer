/*
 *	Shutdown Timer Extension for GNOME shell
 *  Copyright (C) 2012 Lavi .A
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

/*	
 *	Git: https://github.com/lavi741/gnome-shell-extension-shutdown-timer
 *	Launchpad: https://launchpad.net/shutdown-timer
 */

/*
 *			TODO list:
 *	I.		Make customization easier.
 *	II.		Make entry focus default.
 *	III.	Icons.
 */
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const Shell = imports.gi.Shell;	
//=-=-=-=-=-=
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ConsoleKit = imports.gdm.consoleKit;
const Clutter = imports.gi.Clutter;
const MessageTray = imports.ui.messageTray;
const GLib = imports.gi.GLib;
const GnomeSession = imports.misc.gnomeSession;
//Translation
const Gettext = imports.gettext.domain('shutdown-timer');
const _ = Gettext.gettext;
//Variables
let timeout; //Mainloop. defined and used in count() and disable()
let user_locale_path; //Defined in [init]
let remainL; //Label: Remaining time
let timeL;	//Label: Power Off scheduled time
var timeSep = _(":"); 	//localized time separator.
var button = null; //..On panel.
var tick=0; //ticks in Seconds.
var tactive = false; //is timer active - preventing from counting function from running more than once.
var inputLast = 0; //keeps last working input so we can restore it later.
var inputSec = 0; //input in Seconds.
var notifications; //Are notifications turned on.
var notifyFile; //file for loading notification settings

//**OPTIONS/CUSTOMIZATION** //TODO: replace with more intuitive way.
var desplaySec = true; //should the Time of Power Off label display seconds
var preventZero = true; //prevent from running on 0 delay. - DO NOT set to false yet.
var defaultDelay = 3600; //default delay (in seconds) if no input was entered. 3600=1hr.
//**End of: OPTIONS/CUSTOMIZATION**

//Function: init
function init() {
	user_locale_path = global.userdatadir + "/extensions/shutdown-timer@lavi.a/locale";
    imports.gettext.bindtextdomain("shutdown-timer", user_locale_path);
	notifyFile = global.userdatadir + "/extensions/shutdown-timer@lavi.a/notify";
	notifications = getNotify();
}
//Function: enable
function enable() {    
    button = new PanelMenu.Button(0.0);
    let icon = new St.Icon({ icon_name: 'system-run',
                             icon_type: St.IconType.SYMBOLIC,
                             style_class: 'system-status-icon' }); //TODO: set up better icons.
    button.actor.add_actor(icon);
    children = Main.panel._rightBox.get_children();
    Main.panel._rightBox.insert_actor(button.actor, children.length -2); //Place icon next to the UserMenu.
    Main.panel._rightBox.child_set(button.actor, { y_fill : true } );
    Main.panel._menus.addMenu(button.menu);
    init_items(button);
}
//Function: disable
function disable() {
	Main.panel._menus.removeMenu(button.menu);
	Main.panel._rightBox.remove_actor(button.actor);
	tactive = false;
	tick = 0;
	Mainloop.source_remove(timeout);
}
//Function: init_items - draw and define the menu.
function init_items(button) {
	//Label: Remaining time
	remainL = new St.Label({ style_class: 'remain-label', text: remainStr(0, 0, true)});
	button.menu.addActor(remainL);
	//Label: Time of Power off.
	timeL = new St.Label({ style_class: 'time-label', text: print_timeL(0, false)});	
	button.menu.addActor(timeL);
	//Separator.
	let sep1 = new PopupMenu.PopupSeparatorMenuItem();
	button.menu.addMenuItem(sep1);
	//Box (for input padding)
	let box = new St.BoxLayout({vertical: true,
				pack_start: false,
				style_class: "menu-box"});
    button.menu.addActor(box);	
	//input entry.
	let inputF = new St.Entry(
	{
		name: "searchEntry",
		hint_text: _("Delay (minutes/time) e.g. 70 or 18:30"),
		track_hover: true,
		can_focus: true,
		style_class: 'input'
	});
	box.add(inputF);
	//Define: input
	let input = inputF.clutter_text;
	//key event.
	input.connect('key-press-event', function(o,e)
	{
		let symbol = e.get_key_symbol();
	    if (symbol == Clutter.Return || symbol == 65421) //Return key or numpad enter.
	    {
			if(!decodeSeconds(o.get_text())) { //if false (couldn't extract minutes from the string) clear the input entry.
				inputF.set_text('');
			} else {
				if(tactive) { //if already running and new time entered
					tick = 0;
					inputSec = decodeSeconds(o.get_text().toLowerCase());
					inputLast = o.get_text().toLowerCase();
				} else { //if not, turn it on.
					tactive = true;					
					inputSec = decodeSeconds(o.get_text().toLowerCase());
					inputLast = o.get_text().toLowerCase();
					active.setToggleState(true);
					//tactive = true;
					Count();
				}
			}
		}
	});
	//Active switch.
    let active = new PopupMenu.PopupSwitchMenuItem(_("Active"));
    button.menu.addMenuItem(active);
    active.connect("toggled", Lang.bind(this, this.activeState));
	//Notifications switch.
    let notify = new PopupMenu.PopupSwitchMenuItem(_("Notifications"));
    button.menu.addMenuItem(notify);
    notify.connect('toggled', Lang.bind(this, this.notifyState));
	notify.setToggleState(notifications);
}
//Function: activeState - event for Active switch.
function activeState(item) {
	if (item.state) {
		inputSec = decodeSeconds(inputLast);		
		if (inputSec == 0) {
			inputSec = 	defaultDelay;
		}
		tactive = true;
		timeL.text = print_timeL(timeStr(0,0,inputSec), true);
		Count();
	} else {
		tactive = false;
		tick = 0;
		timeL.text = print_timeL(0, false);
	}
}
//Function: notifyState - event for Notifications switch.
function notifyState(item) {
	if (item.state) {
		notifications = true;
		setNotify(true);
	} else {
		notifications = false;
		setNotify(false);
	}
}
//Function: isDigits - return boolean for strings.
function isDigits(str) {
return /^\d+$/.test(str);
}
//Function: decodeSeconds - convert string to seconds.
function decodeSeconds(intext) {
	if(isDigits(intext)) { //if all digits >> send as minutes.
		if(parseInt(intext) == 0 && preventZero) {
			return false;
		}
		if (tactive) {
			timeL.text = print_timeL(timeStr(0,0,(intext * 60)), true);
		}
		return intext*60;
	}
	var h; //hours
	var m; //minutes
	var br = false; //allowing to break out of the if extracted.
	var seps = new Array(':','.',_(',')); //known separators for 18:30 or 15.10. last one can be localized
	var times = new Array("am","pm"); //same for all English speaking countries. contact if it needs localization.
	for (var i in seps) {
		if(intext.indexOf(seps[i]) != -1) { //separator exists.
			if(intext.indexOf(times[0]) != -1 || intext.indexOf(times[1]) != -1) { //12 hour
				if(intext.indexOf(seps[i]) == 1) {
					if(intext.indexOf(times[1]) != -1) {
						h = parseInt(intext[0]) + 12;
					} else {
						h = parseInt(intext[0]);
					}					
					m = (parseInt(intext[2] * 10) + parseInt(intext[3]));					
					br = true;
					break;
				} else if(intext.indexOf(seps[i]) == 2) {
					if(intext.indexOf(times[1]) != -1) {
						if((parseInt(intext[0] * 10) + parseInt(intext[1])) != 12) {
							h = ((parseInt(intext[0] * 10) + parseInt(intext[1])) + 12);
						} else { 
							h = 12;
						}
					} else {
						if((parseInt(intext[0] * 10)+parseInt(intext[1])) != 12) {
							h = parseInt(intext[0] * 10) + parseInt(intext[1]);
						} else {
							h = 0;
						}
					}
					m = parseInt(intext[3] * 10) + parseInt(intext[4]);
					br = true;
					break;
				}
			} else {
				if(intext.indexOf(seps[i]) == 1) {
					h = parseInt(intext[0]);
					m = parseInt(intext[2] * 10) + parseInt(intext[3]);								
					br = true;
					break;
				} else if(intext.indexOf(seps[i]) == 2) {
					h = parseInt(intext[0] * 10) + parseInt(intext[1]);
					m = parseInt(intext[3] * 10) + parseInt(intext[4]);
					br = true;
					break;
				}
			}
		}
	}
	if(!br) {
		return false;
	}
	var now = new Date();
	if (tactive) {
		timeL.text = print_timeL(timeStr(parseInt(h),parseInt(m)), true);
	}
	if ((now.getHours() * 60 + now.getMinutes()) < (h * 60 + m)) {
		//timeL.text = print_timeL(timeStr(0,0,((((h * 60 + m) - (now.getHours() * 60 + now.getMinutes())) * 60) - now.getSeconds())), true);
		return ((((h * 60 + m) - (now.getHours() * 60 + now.getMinutes())) * 60) - now.getSeconds());
	} else {
		//timeL.text = print_timeL(timeStr(0,0,(((((24 - now.getHours()) + h) * 60 + m) * 60) - (now.getMinutes() * 60 + now.getSeconds()))), true);
		return (((((24 - now.getHours()) + h) * 60 + m) * 60) - (now.getMinutes() * 60 + now.getSeconds()));
	}
}
//Function: Count
function Count()
{
	if (tactive) {
		remainL.text = remainStr(inputSec, tick);
		tick=tick+1;
		timeout = Mainloop.timeout_add_seconds(1, Lang.bind(this, Count));;
		if ((notifications) && (((inputSec - tick) == 60) || (((inputSec - tick) % 900 == 0) && ((inputSec - tick) < 7200)) || ((inputSec - tick) % 3600 == 0))) {
			ntf((inputSec - tick) / 60);
		}
		if (tick == inputSec) {
			tactive = false;
			shutdown();
		}
	} else {
		remainL.text = remainStr(0, 0);
	}
}
//Function: timeStr - return localized time string. (h,m) for time, if (delay) exist >> delay in seconds.
function timeStr(h,m,delay) {
	var tmpStr;				//temp string - return it.
	var timeOpt = _("3");	//Time options (sum of): 1=leading zero,2=24hr clock. (so 0 is none of, and 3 is both.
	var pm = false;			//for 12hr - is it after 12.
	var s = 0;				//seconds.
	if (typeof delay != 'undefined' ) { // delay.
		var cTime = new Date();
		cTime.setTime(cTime.getTime() + (delay * 1000));
		h = cTime.getHours();
		m = cTime.getMinutes();
		s = cTime.getSeconds();
	}
	//h = parseInt(h);
	if (h >= 12 && timeOpt < 2) {
		h = h - 12;
		pm = true;
	}
	if (h == 0 && timeOpt < 2) {
		h = 12;
	}
	if (h < 10 && timeOpt > 0 && timeOpt != 2) {
		tmpStr = "0" + h.toString();
	} else {
		tmpStr = h.toString();
	}
	if (m < 10) {
		tmpStr = tmpStr + timeSep + "0" + m.toString();
	} else {
		tmpStr = tmpStr + timeSep + m.toString();
	}
	if (desplaySec) {
		if (s < 10) {
			tmpStr = tmpStr + timeSep + "0" + s.toString();
		} else {
			tmpStr = tmpStr + timeSep + s.toString();
		}
	}
	if (timeOpt < 2) {
		if (pm) {
			tmpStr = tmpStr + " PM";
		} else {
			tmpStr = tmpStr + " AM";
		}
	}
	return tmpStr;
}
//Function: print_timeL - change text of Time Label. time[time string],active[bool]
function print_timeL(time, active) {
	var on = _("The System will Power Off at %s".format(time));
	var off = _("Timer is currently inactive.");
	if (active) {
		return on;
	} else {
		return off;
	}
}
//Function: returns string for time remaining.
function remainStr(iS, eS) {
	var tmpStr;	
	var t = new Date();
	t.setTime((iS - eS) * 1000);
	if (t.getUTCHours() < 10) {
		tmpStr = "0" + t.getUTCHours().toString();
	} else {
		tmpStr = t.getUTCHours().toString();
	}
	if (t.getUTCMinutes() < 10) {
		tmpStr = tmpStr + timeSep + "0" + t.getUTCMinutes().toString();
	} else {
		tmpStr = tmpStr + timeSep + t.getUTCMinutes().toString();
	}
	if (t.getUTCSeconds() < 10) {
		tmpStr = tmpStr + timeSep + "0" + t.getUTCSeconds().toString();
	} else {
		tmpStr = tmpStr + timeSep + t.getUTCSeconds().toString();
	}
	return tmpStr;
}
//Function: ntf - Send desktop notification
function ntf(t)
{
	var msg = _("The system will power off in %s minutes.".format(t));
	let src = new MessageTray.SystemNotificationSource();
    Main.messageTray.add(src);
    let notification = new MessageTray.Notification(src, msg, null);
    notification.setTransient(true);
    src.notify(notification);
}
//Function: setNotify - set Notification state in file.
function getNotify() {
	if (GLib.file_test(notifyFile, GLib.FileTest.EXISTS))
		{
			let content = Shell.get_file_contents_utf8_sync(notifyFile);
			if (content.indexOf("true") != -1) {
				return true;
			} else {
				return false;
			}
		} else { 
			global.logError("Shutdown Timer: Error while reading file: " + notifyFile); 
		}
}
//Function: setNotify - write to file current notification state
function setNotify(n) {
	if (GLib.file_test(notifyFile, GLib.FileTest.EXISTS))
	{
		let content = Shell.get_file_contents_utf8_sync(notifyFile);
		if (n) {
			content = "true";
		} else {
			content = "false";
		}
		let f = Gio.file_new_for_path(notifyFile);
		let out = f.replace(null, false, Gio.FileCreateFlags.NONE, null);
		Shell.write_string_to_stream (out, content);
	} else { 
		global.logError("Shutdown Timer: Error while writing file: " + notifyFile); 
	}
}
//Function: shutdown. Power off the system.
function shutdown() {
	session = new GnomeSession.SessionManager();
	session.ShutdownRemote();
	//ckm = new ConsoleKit.ConsoleKitManager();
	//ckm.StopRemote();
}
