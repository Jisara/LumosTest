import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:health/health.dart';
import 'package:http/http.dart' as http;

void main() {
  runApp(const HealthSenderApp());
}

class HealthSenderApp extends StatelessWidget {
  const HealthSenderApp({super.key});

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
      home: HealthSenderPage(),
      debugShowCheckedModeBanner: false,
    );
  }
}

class HealthSenderPage extends StatefulWidget {
  const HealthSenderPage({super.key});

  @override
  State<HealthSenderPage> createState() => _HealthSenderPageState();
}

class _HealthSenderPageState extends State<HealthSenderPage> {
  final Health health = Health();

  // CHANGE THIS to your Lenovo IPv4 address (server expects POST /api/sync)
  final String backendUrl = "http://10.0.0.179:3000/api/sync";

  String status = "Ready";

  final List<HealthDataType> types = [
    HealthDataType.STEPS,
    HealthDataType.HEART_RATE,
  ];

  Future<void> requestAndSendHealthData() async {
    setState(() {
      status = "Requesting Health permissions...";
    });

    final permissions = [
      HealthDataAccess.READ,
      HealthDataAccess.READ,
    ];

    final bool granted = await health.requestAuthorization(
      types,
      permissions: permissions,
    );

    if (!granted) {
      setState(() {
        status = "Permission denied";
      });
      return;
    }

    setState(() {
      status = "Reading Health data...";
    });

    final now = DateTime.now();
    final start = now.subtract(const Duration(hours: 24));

    try {
      final steps = await health.getTotalStepsInInterval(start, now);

      final heartRateData = await health.getHealthDataFromTypes(
        types: [HealthDataType.HEART_RATE],
        startTime: start,
        endTime: now,
      );

      double? latestHeartRate;
      DateTime? latestHeartRateDate;

      if (heartRateData.isNotEmpty) {
        heartRateData.sort((a, b) => b.dateFrom.compareTo(a.dateFrom));
        latestHeartRate = double.tryParse(
          heartRateData.first.value.toString(),
        );
        latestHeartRateDate = heartRateData.first.dateFrom;
      }

      // Build payload as arrays of data points to match server `/api/sync` format
      final payload = {
        "steps": [
          {
            "startDate": start.toIso8601String(),
            "endDate": now.toIso8601String(),
            "value": steps ?? 0,
            "unit": "count",
            "source": "iPhone HealthKit"
          }
        ],
        "heartRate": latestHeartRate != null
            ? [
                {
                  "startDate": latestHeartRateDate?.toIso8601String() ?? now.toIso8601String(),
                  "endDate": latestHeartRateDate?.toIso8601String() ?? now.toIso8601String(),
                  "value": latestHeartRate,
                  "unit": "bpm",
                  "source": "iPhone HealthKit"
                }
              ]
            : []
      };

      setState(() {
        status = "Sending to backend...";
      });

      final response = await http.post(
        Uri.parse(backendUrl),
        headers: {"Content-Type": "application/json"},
        body: jsonEncode(payload),
      );

      setState(() {
        status = "Sent! Backend status: ${response.statusCode}\n${response.body}";
      });
    } catch (e) {
      setState(() {
        status = "Error: $e";
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text("Health Sender"),
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                status,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              ElevatedButton(
                onPressed: requestAndSendHealthData,
                child: const Text("Send Health Data"),
              ),
            ],
          ),
        ),
      ),
    );
  }
}