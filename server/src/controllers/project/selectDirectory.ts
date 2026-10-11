import { execFile } from 'node:child_process';
import type { Request, Response } from 'express';

const pickerScript = `
import ctypes
import json
import os
import signal
import sys
import time
import uuid
from urllib.parse import unquote_to_bytes, urlsplit
import dbus
from dbus.mainloop.glib import DBusGMainLoop

DBusGMainLoop(set_as_default=True)
bus = dbus.SessionBus(private=True)
service = "org.freedesktop.portal.Desktop"
request_interface = "org.freedesktop.portal.Request"
portal = dbus.Interface(
    bus.get_object(service, "/org/freedesktop/portal/desktop"),
    "org.freedesktop.portal.FileChooser",
)
token = "agent_manager_" + uuid.uuid4().hex
sender = bus.get_unique_name().lstrip(":").replace(".", "_")
handle = "/org/freedesktop/portal/desktop/request/" + sender + "/" + token
responses = []

def receive_response(code, results):
    responses.append((int(code), results))

def subscribe(path):
    return bus.add_signal_receiver(
        receive_response,
        signal_name="Response",
        dbus_interface=request_interface,
        bus_name=service,
        path=path,
    )

# Subscribe before OpenFile to avoid missing an immediate response.
subscription = subscribe(handle)
# Use the GLib context installed with dbus-python, without requiring PyGObject.
glib = ctypes.CDLL("libglib-2.0.so.0")
glib.g_main_context_iteration.argtypes = [ctypes.c_void_p, ctypes.c_int]
glib.g_main_context_iteration.restype = ctypes.c_int
signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))

try:
    returned_handle = str(portal.OpenFile(
        "",
        "Choose folder",
        {
            "handle_token": token,
            "directory": dbus.Boolean(True),
            "multiple": dbus.Boolean(False),
            "current_folder": dbus.ByteArray(os.fsencode(os.path.expanduser("~")) + b"\\0"),
        },
    ))
    if returned_handle != handle:
        subscription.remove()
        handle = returned_handle
        subscription = subscribe(handle)

    while not responses:
        glib.g_main_context_iteration(None, False)
        time.sleep(0.02)

    code, results = responses[0]
    if code == 1:
        print("null")
    elif code == 0:
        uris = results.get("uris", [])
        if len(uris) != 1:
            raise RuntimeError("The portal did not return one folder")
        uri = urlsplit(str(uris[0]))
        if uri.scheme != "file" or uri.netloc not in ("", "localhost"):
            raise RuntimeError("The portal did not return a local folder")
        print(json.dumps(os.fsdecode(unquote_to_bytes(uri.path))))
    else:
        raise RuntimeError("The portal could not select a folder")
finally:
    if not responses:
        try:
            dbus.Interface(bus.get_object(service, handle), request_interface).Close()
        except dbus.DBusException:
            pass
    subscription.remove()
    bus.close()
`;

let selecting = false;

export default function selectDirectory(_request: Request, response: Response) {
  if (selecting) {
    response.status(409).json({ error: 'A folder picker is already open.' });
    return;
  }

  selecting = true;
  const picker = execFile('python3', ['-c', pickerScript], (error, stdout) => {
    selecting = false;

    if (response.destroyed) {
      return;
    }

    if (error) {
      console.error('Folder picker failed:', error);
      response
        .status(500)
        .json({ error: 'Could not open the folder picker on this machine.' });
      return;
    }

    try {
      const path: unknown = JSON.parse(stdout);

      if (path !== null && typeof path !== 'string') {
        throw new Error('Invalid folder picker response');
      }

      response.json({ path });
    } catch (error) {
      console.error('Folder picker failed:', error);
      response
        .status(500)
        .json({ error: 'Could not read the selected folder.' });
    }
  });

  response.once('close', () => {
    if (picker.exitCode === null) {
      picker.kill();
    }
  });
}
