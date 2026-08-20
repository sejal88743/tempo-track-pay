import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { MapPin } from "lucide-react";
import { getSettings } from "@/lib/store";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_admin/godowns")({ component: GodownsPage });

function GodownsPage() {
  const settings = getSettings();
  const loc = settings.office_location;

  return (
    <div className="p-6 space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Office / Godown Location</h1>
        <p className="text-sm text-muted-foreground">
          GPS fence — workers ko attendance mark karne ke liye yahan hona padega
        </p>
      </div>

      {loc ? (
        <Card className="p-6 space-y-3">
          <div className="flex items-center gap-2 text-green-600">
            <MapPin className="size-5" />
            <span className="font-semibold">{loc.label}</span>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Latitude:</span>{" "}
              <span className="font-mono">{loc.lat.toFixed(6)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Longitude:</span>{" "}
              <span className="font-mono">{loc.lng.toFixed(6)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Radius:</span>{" "}
              <span className="font-semibold">{loc.radius_meters}m</span>
            </div>
          </div>
          <a
            href={`https://maps.google.com/?q=${loc.lat},${loc.lng}`}
            target="_blank"
            rel="noreferrer"
            className="text-primary text-sm underline"
          >
            Google Maps par dekho ↗
          </a>
        </Card>
      ) : (
        <Card className="p-8 text-center space-y-3">
          <MapPin className="size-12 text-muted-foreground mx-auto" />
          <p className="text-muted-foreground">Location set nahi hai.</p>
          <p className="text-sm text-muted-foreground">
            Settings page par jaake apne phone se location pin karo.
          </p>
          <Button asChild>
            <Link to="/settings">Settings → Location Pin Karo</Link>
          </Button>
        </Card>
      )}
    </div>
  );
}
