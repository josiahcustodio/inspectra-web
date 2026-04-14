import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Settings as SettingsIcon, User, Bell, Shield, Database, Mail } from "lucide-react";

export function Settings() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-bold text-[#333333]">Settings</h2>
        <p className="text-[#999999] mt-1">Manage system preferences and configurations</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Settings */}
        <Card className="p-6 bg-white rounded-xl border border-gray-200 lg:col-span-2">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-[#f0f4ed] flex items-center justify-center">
              <User className="w-5 h-5 text-[#87A96B]" />
            </div>
            <h3 className="font-bold text-[#333333]">Profile Settings</h3>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">First Name</Label>
                <Input id="firstName" defaultValue="Supervisor" className="mt-1" />
              </div>
              <div>
                <Label htmlFor="lastName">Last Name</Label>
                <Input id="lastName" defaultValue="Admin" className="mt-1" />
              </div>
            </div>
            <div>
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                defaultValue="supervisor@batangas.gov.ph"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="phone">Phone Number</Label>
              <Input id="phone" defaultValue="+63 912 345 6789" className="mt-1" />
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline">Cancel</Button>
              <Button className="bg-[#87A96B] hover:bg-[#7a9860] text-white">
                Save Changes
              </Button>
            </div>
          </div>
        </Card>

        {/* Quick Actions */}
        <Card className="p-6 bg-white rounded-xl border border-gray-200">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-[#f0f4ed] flex items-center justify-center">
              <SettingsIcon className="w-5 h-5 text-[#87A96B]" />
            </div>
            <h3 className="font-bold text-[#333333]">Quick Actions</h3>
          </div>
          <div className="space-y-3">
            <Button variant="outline" className="w-full justify-start gap-2">
              <Database className="w-4 h-4" />
              Export Data
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2">
              <Mail className="w-4 h-4" />
              Generate Report
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2">
              <Shield className="w-4 h-4" />
              System Backup
            </Button>
          </div>
        </Card>
      </div>

      {/* Notifications */}
      <Card className="p-6 bg-white rounded-xl border border-gray-200">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-[#f0f4ed] flex items-center justify-center">
            <Bell className="w-5 h-5 text-[#87A96B]" />
          </div>
          <h3 className="font-bold text-[#333333]">Notification Preferences</h3>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-3 border-b border-gray-100">
            <div>
              <p className="font-bold text-[#333333]">Failed Inspections</p>
              <p className="text-sm text-[#999999]">
                Get notified when an establishment fails inspection
              </p>
            </div>
            <Switch defaultChecked />
          </div>
          <div className="flex items-center justify-between py-3 border-b border-gray-100">
            <div>
              <p className="font-bold text-[#333333]">Daily Summary</p>
              <p className="text-sm text-[#999999]">
                Receive daily reports of all inspections
              </p>
            </div>
            <Switch defaultChecked />
          </div>
          <div className="flex items-center justify-between py-3 border-b border-gray-100">
            <div>
              <p className="font-bold text-[#333333]">Re-inspection Due</p>
              <p className="text-sm text-[#999999]">
                Alerts when re-inspections are approaching
              </p>
            </div>
            <Switch defaultChecked />
          </div>
          <div className="flex items-center justify-between py-3 border-b border-gray-100">
            <div>
              <p className="font-bold text-[#333333]">System Updates</p>
              <p className="text-sm text-[#999999]">
                Notifications about system maintenance and updates
              </p>
            </div>
            <Switch />
          </div>
        </div>
      </Card>

      {/* System Information */}
      <Card className="p-6 bg-white rounded-xl border border-gray-200">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-[#f0f4ed] flex items-center justify-center">
            <Shield className="w-5 h-5 text-[#87A96B]" />
          </div>
          <h3 className="font-bold text-[#333333]">System Information</h3>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-[#999999]">System Version</p>
            <p className="font-bold text-[#333333]">v2.4.1</p>
          </div>
          <div>
            <p className="text-[#999999]">Last Updated</p>
            <p className="font-bold text-[#333333]">March 1, 2026</p>
          </div>
          <div>
            <p className="text-[#999999]">Database Status</p>
            <p className="font-bold text-[#87A96B]">Operational</p>
          </div>
          <div>
            <p className="text-[#999999]">Total Users</p>
            <p className="font-bold text-[#333333]">12</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
