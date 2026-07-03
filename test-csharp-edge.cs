using System; using System.Diagnostics; class Program { static void Main() { Process.Start(new ProcessStartInfo("msedge.exe", "--app=https://bing.com --disable-devtools")); } }
