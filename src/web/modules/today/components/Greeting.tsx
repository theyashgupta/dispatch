interface GreetingProps {
  greeting: string;
  date: string;
}

export function Greeting({ greeting, date }: GreetingProps) {
  return (
    <div>
      <p className="m-0 text-(length:--font-display) leading-(--line-display) font-semibold text-foreground">
        {greeting}
      </p>
      <p className="m-0 text-base text-muted-foreground">{date}</p>
    </div>
  );
}
