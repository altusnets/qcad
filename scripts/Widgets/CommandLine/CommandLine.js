/**
 * Copyright (c) 2011-2016 by Andrew Mustun. All rights reserved.
 * 
 * DirectDistanceEntry handling added 2013 by Robert S.
 *
 * This file is part of the QCAD project.
 *
 * QCAD is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * QCAD is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with QCAD.
 */

include("scripts/EAction.js");
include("scripts/WidgetFactory.js");

function CommandLine(guiAction) {
    EAction.call(this, guiAction);
}

CommandLine.getPreferencesCategory = function() {
    return [ qsTr("Widgets"), qsTr("Command Line") ];
};

CommandLine.prototype = new EAction();

/**
 * Shows / hides the command line widget.
 */
CommandLine.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);

    var appWin = RMainWindowQt.getMainWindow();
    var dock = appWin.findChild("CommandLineDock");
    if (!QCoreApplication.arguments().contains("-no-show")) {
        dock.visible = !dock.visible;
        if (dock.visible) dock.raise();
    }
};

CommandLine.prototype.finishEvent = function() {
    EAction.prototype.finishEvent.call(this);

    var appWin = RMainWindowQt.getMainWindow();
    var dock = appWin.findChild("CommandLineDock");
    this.getGuiAction().setChecked(dock.visible);
};

CommandLine.init = function(basePath) {
    var appWin = EAction.getMainWindow();

    var action = new RGuiAction(qsTr("&Command Line"), appWin);
    action.setRequiresDocument(false);
    action.setScriptFile(basePath + "/CommandLine.js");
    action.setIcon(basePath + "/CommandLine.svg");
    action.setDefaultShortcut(new QKeySequence("g,m"));
    action.setDefaultCommands(["gm"]);
    action.setGroupSortOrder(3800);
    action.setSortOrder(100);
    action.setWidgetNames(["ViewMenu", "WidgetsToolBar", "ViewToolsPanel", "WidgetsMatrixPanel"]);

    var e;
    var formWidget = WidgetFactory.createWidget(basePath, "CommandLine.ui");
    var teHistory = formWidget.findChild("History");
    var leCommand = formWidget.findChild("CommandEdit");
    var lCommand = formWidget.findChild("CommandLabel");
    var bToggleTitleBar = formWidget.findChild("ToggleTitleBar");
    var dock = new RDockWidget(qsTr("Command Line"), appWin);
    dock.objectName = "CommandLineDock";
    dock.setWidget(formWidget);
    //dock.setSizePolicy(QSizePolicy.Ignored, QSizePolicy.MinimumExpanding);
    appWin.addDockWidget(Qt.BottomDockWidgetArea, dock);
    dock.shown.connect(function() { action.setChecked(true); });
    dock.hidden.connect(function() { action.setChecked(false); });

    var blue = "#0000cc";
    if (RSettings.hasDarkGuiBackground()) {
        blue = "#2E9AFE";
    }

    function appendAndScroll(msg) {
        teHistory.append(msg);
        var c = teHistory.textCursor();
        c.movePosition(QTextCursor.End);
        teHistory.setTextCursor(c);
        teHistory.ensureCursorVisible();

        var appWin = EAction.getMainWindow();
        var dlg = appWin.findChild("ProgressDialog");
        if (!appWin.enabled || (!isNull(dlg) && dlg.visible)) {
            QCoreApplication.processEvents();
        }
    }

    var showTitleBar = RSettings.getBoolValue("Appearance/CommandLineTitleBar", false);
    if (!showTitleBar) {
        dock.setTitleBarWidget(new QWidget(dock));
        bToggleTitleBar.checked = false;
    }
    else {
        bToggleTitleBar.checked = true;
    }

    // hide title bar of command line dock widget:
    bToggleTitleBar.toggled.connect(
                function(show) {
                    if (show) {
                        dock.setTitleBarWidget(null);
                        RSettings.setValue("Appearance/CommandLineTitleBar", true);
                    }
                    else {
                        dock.setTitleBarWidget(new QWidget(dock));
                        RSettings.setValue("Appearance/CommandLineTitleBar", false);
                    }
                });

    // user edited command line. if input is a valid coordinate: preview
    leCommand.textChanged.connect(function(command) {
        var di = appWin.getDocumentInterface();
        if (isNull(di)) {
            return;
        }

        // handle action specific commands for preview:
        e = new RCommandEvent(command);
        di.commandEventPreview(e);
        if (e.isAccepted()) {
            di.repaintViews();
            return;
        }

        // handle math expressions preview,
        if (command.startsWith("=")) {
            return;
        }

        if (di.getClickMode() !== RAction.PickCoordinate) {
            return;
        }

        var view = di.getLastKnownViewWithFocus();

        // handle direct distance entry for preview:
        var pos = stringToDirectDistanceEntry(di.getRelativeZero(), di.getCursorPosition(), command);

        // handle coordinate entry for preview:
        if (isNull(pos) || !pos.isValid()) {
            pos = stringToCoordinate(di.getRelativeZero(), command);
        }

        var sp;

        if (isNull(pos) || !pos.isValid()) {
            sp = di.getCursorPosition();
            di.clearPreview();
            di.repaintViews();
            di.setCursorPosition(sp);
            return;
        }

        sp = di.getCursorPosition();
        di.setCursorPosition(pos);
        appWin.notifyCoordinateListeners(di);

        e = new RCoordinateEvent(pos, view.getScene(), view.getRGraphicsView());
        di.clearPreview();
        di.coordinateEventPreview(e);
        di.repaintViews();
        di.setCursorPosition(sp);
    });
    
    // user pressed enter, enter command or coordinate:
    leCommand.commandConfirmed.connect(function(command) {
        // enter with empty input: repeat last command:
        if (command === "") {
            var last = leCommand.getLastCommand();
            if (last !== "") {
                arguments.callee(last);
                return;
            }
        }

        var di = appWin.getDocumentInterface();

        if (!isNull(di)) {
            // handle action specific commands:
            var e = new RCommandEvent(command);
            di.commandEvent(e);
            if (e.isAccepted()) {
                //appWin.handleUserCommand(command);
                leCommand.clear();
                return;
            }

            // handle math expressions and leave result in command line,
            // or, if error, print error and leave command line unchanged
            if (command.startsWith("=")) {
                // remove leading '='
                command = command.slice(1);
                var prefix = "=";
                var relprefix = RSettings.getStringValue(
                            "Input/RelativeCoordinatePrefix",
                            String.fromCharCode(64)  // @ (doxygen can't cope with an @ here)
                );
                if (command.endsWith(" ")) {
                    prefix = "";
                } else if (command.endsWith(relprefix)) {
                    command = command.replace(relprefix, "");
                    prefix = relprefix;
                }

                var val = RMath.eval(command);
                if (isNumber(val)) {
                    appWin.handleUserCommand("=" + command);
                    leCommand.text = prefix + val;
                } else {
                    var er = RMath.getError();
                    EAction.handleUserWarning(qsTr("Invalid value:") + " '=%1' -  %2".arg(command).arg(er));
                }
                return;
            }

            // handle direct distance entry:
            var pos = stringToDirectDistanceEntry(di.getRelativeZero(), di.getCursorPosition(), command);

            // handle coordinate entry:
            if (isNull(pos) || !pos.isValid()) {
                pos = stringToCoordinate(di.getRelativeZero(), command);
            }

            if (!isNull(pos)) {
                if (!pos.isValid()) {
                    appWin.handleUserWarning(
                        qsTr("Invalid coordinate or distance '%1'.")
                            .arg(Qt.escape(command))
                    );
                    return;
                }

                var view = di.getLastKnownViewWithFocus();
                e = new RCoordinateEvent(pos, view.getScene(), view.getRGraphicsView());
                di.coordinateEvent(e);
                appWin.handleUserCommand(command);
                leCommand.clear();
                return;
            }
        }

        // handle commands that trigger new actions:
        var commandLower = command.toLowerCase();
        if (!RGuiAction.triggerByCommand(commandLower)) {
            EAction.handleUserWarning(
                qsTr("Unknown command or invalid coordinate or value: '%1'").arg(commandLower)
            );

            // guess: if there's a number somewhere, user might be trying to enter
            // a number value or coordinate. Nuge him in the right direction:
            if (command.search(/[0-9]./)!==-1) {
                EAction.handleUserWarning(
                    qsTr("Numbers may be entered as: '%1'")
                        .arg(numberToString(Math.PI, 3))
                );
                var sample = new RVector(1.234,1.234);
                var samplePolar = RVector.createPolar(10,30);
                EAction.handleUserWarning(
                    qsTr("Coordinates may be entered as: '%1' (absolute) " +
                         "or '%2' (relative) or '%3' (polar) or '%4' (relative polar)")
                        .arg(coordinateToString(sample, 3, false, false))
                        .arg(coordinateToString(sample, 3, true, false))
                        .arg(coordinateToString(samplePolar, 3, false, true))
                        .arg(coordinateToString(samplePolar, 3, true, true))
                );
                EAction.handleUserWarning(
                    qsTr("You may change the number / coordinate " +
                        "format in the application preferences.")
                );
            }
            return;
        }

        leCommand.clear();

        var historySize = RSettings.getIntValue("Console/HistorySize", 1000);
        var buf = teHistory.plainText.split("\n");
        if (buf.length > historySize) {
            teHistory.setPlainText(buf.slice(-historySize).join("\n"));
        }
        leCommand.setFocus();
    });
    
    // user pressed tab:
    leCommand.completeCommand.connect(function(command) {
        var choices = RGuiAction.getAvailableCommands(command, true);
        if (choices.length === 0) {
            // no commands match. beep?
        } else if (choices.length == 1) {
            // only one command matches. complete it:
            leCommand.text = choices[0];
        } else {
            // suggest multiple commands that match so far:
            appendAndScroll(choices.join(", "));

            // complete as much as possible:
            var done = false;
            var i = command.length;
            do {
                for (var k=0; k<choices.length; ++k) {
                    if (choices[k].length <= i) {
                        done = true;
                        break;
                    }

                    if (choices[k][i] != choices[0][i]) {
                        done = true;
                        break;
                    }
                }
                if (!done) {
                    command = command.concat(choices[0][i++]);
                }
            } while(!done);

            leCommand.text = command;
        }
    });
    
    leCommand.clearHistory.connect(teHistory, "clear");

    // show message to user:
    appWin.userMessage.connect(function(message) {
            appendAndScroll("<span>" + message + "</span>");
        });

    // show warning to user:
    appWin.userWarning.connect(function(message, messageBox) {
            // TODO: refactor:
            if (message==="#transaction_failed") {
                message = qsTr("Transaction failed. Please check for block recursions and locked or invisible layers or blocks.");
            }

            appendAndScroll("<span style='color:#cc0000;'>" + Qt.escape(message) + "</span>");
            if (RSettings.getBoolValue("CommandLine/WarningsAsDialog", false) || messageBox) {
                QMessageBox.warning(appWin, qsTr("Warning"), message);
            }
        });

    // show info to user:
    appWin.userInfo.connect(function(message) {
            appendAndScroll("<span style='color:#0066cc;'>" + Qt.escape(message) + "</span>");
            if (RSettings.getBoolValue("CommandLine/InfoAsDialog", false)) {
                QMessageBox.information(appWin, qsTr("Info"), message);
            }
        });

    // show previously entered command:
    appWin.userCommand.connect(function(message) {
        // prevent some very frequent commands from being displayed every time:
        if (message==="snapauto" || message==="restrictoff" || message==="escape") {
            return;
        }

        var cartCoordSep = RSettings.getStringValue("Input/CartesianCoordinateSeparator", ',');
        var polCoordSep = RSettings.getStringValue("Input/PolarCoordinateSeparator", '<');
        var what;
        if (message.contains(cartCoordSep) || message.contains(polCoordSep)) {
            what = qsTr("Coordinate");
        }
        else {
            what = qsTr("Command");
        }
        leCommand.appendCommand(message);
        appendAndScroll(
            "<span style='color:" + blue + ";'>"
            + "<i>" + what + ": </i>"
            + Qt.escape(message) + "</span>");
    });

    // change command prompt label:
    appWin.commandPrompt.connect(function(text) {
        if (text.length===0) {
            lCommand.text = qsTr("Command:") + " ";
        }
        else {
            lCommand.text = text + qsTr(": ");
        }
    });
};
