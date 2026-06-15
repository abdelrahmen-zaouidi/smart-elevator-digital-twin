# Thesis Caption — General Electrical Schematic (Rev B)

## 1. Figure caption

> **Figure X.Y — General electrical schematic of the reduced-scale ESP32-S3 smart elevator prototype**, showing ATX standby and main-rail power distribution, the ESP32-S3 controller, KY-024 Hall effect floor-confirmation sensors, SPDT door end-position limit switches, stepper and door motor drivers, RC522 RFID interface, LCD, buzzer, emergency input, simulated ADC telemetry proxies, and cooling fan relay. The schematic separates logic and actuator power while sharing a common ground reference. GPIO0, GPIO3, GPIO45, GPIO46, and native USB-related GPIO19/GPIO20 require final board-level verification before permanent wiring. The diagram documents the laboratory prototype wiring architecture and does not represent a certified industrial elevator controller.

Short alternative (for the list of figures):

> General electrical schematic of the reduced-scale ESP32-S3 smart elevator prototype.

## 2. Explanatory paragraph (insert before/after the figure)

The schematic is organised around the ESP32-S3-DevKitC-1, which concentrates all sensing and actuation interfaces of the prototype. An ATX power supply provides a clearly separated standby and main-rail structure: the always-live +5VSB standby rail powers the controller through 5V/VIN, while the +12 V, +5 V and +3.3 V main rails are enabled only when a KCD1 rocker switch closes the active-low PS-ON line to ground. Physical floor confirmation is provided by four KY-024 Hall effect modules powered from the ATX +3.3 V rail and triggered magnetically — a non-electrical coupling — by a cabin-mounted magnet, while two SPDT limit switches confirm the door end positions using a fail-aware normally-closed wiring scheme summarised in an on-figure truth table. All subsystems share a single common ground, 3.3 V logic levels are enforced at every controller input, and a deliberate distinction is drawn between the on-board ESP32 3V3 regulator output (which supplies the RC522 reader and the analogue potentiometers) and the separate ATX +3.3 V sensor rail. Because the controller is fed from +5VSB, it can remain powered while the main rails are off; the figure therefore carries an explicit standby-power note so that firmware treats the sensors as unavailable in that state. The MQTT/Ditto/SCADA software chain is drawn only as a dashed boundary to make explicit that it involves no physical wiring, and the strapping-sensitive and native-USB GPIOs (GPIO0, GPIO3, GPIO45, GPIO46, GPIO19, GPIO20) are flagged in a dedicated caution box for final board-level verification.

## 3. LaTeX insertion snippet

The schematic is A3 landscape. Copy the PDF into the thesis figures directory first:

```text
copy "docs\electrical\elevator_general_electrical_schematic.pdf" "<master-thesis1>\figures\"
```

Recommended insertion — scaled onto an A4 landscape page (the A3 vector scales down cleanly):

```latex
% requires \usepackage{pdflscape} (or lscape) and \usepackage{graphicx}
\begin{landscape}
\begin{figure}[p]
    \centering
    \includegraphics[width=\linewidth,height=0.92\textheight,keepaspectratio]%
        {figures/elevator_general_electrical_schematic.pdf}
    \caption[General electrical schematic of the reduced-scale ESP32-S3 smart
    elevator prototype]{General electrical schematic of the reduced-scale
    ESP32-S3 smart elevator prototype, showing ATX standby and main-rail power
    distribution, the ESP32-S3 controller, KY-024 Hall effect floor-confirmation
    sensors, SPDT door end-position limit switches, stepper and door motor
    drivers, RC522 RFID interface, LCD, buzzer, emergency input, simulated ADC
    telemetry proxies, and cooling fan relay. The schematic separates logic and
    actuator power while sharing a common ground reference. GPIO0, GPIO3, GPIO45,
    GPIO46, and native USB-related GPIO19/GPIO20 require final board-level
    verification before permanent wiring. The diagram documents the laboratory
    prototype wiring architecture and does not represent a certified industrial
    elevator controller.}
    \label{fig:electrical-schematic}
\end{figure}
\end{landscape}
```

Portrait alternative (no landscape package; smaller):

```latex
\begin{figure}[!htbp]
    \centering
    \includegraphics[width=\textwidth]{figures/elevator_general_electrical_schematic.pdf}
    \caption{General electrical schematic of the reduced-scale ESP32-S3 smart elevator prototype.}
    \label{fig:electrical-schematic}
\end{figure}
```

Reference in text: `\Cref{fig:electrical-schematic}` (cleveref) or `Figure~\ref{fig:electrical-schematic}`.
